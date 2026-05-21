import { z } from 'zod';
import { evaluateNarratorOutput } from './narrator-voice-evals.mjs';

/**
 * Repeatedly generates, validates, optionally normalizes, and evaluates model output until an attempt passes or attempts are exhausted.
 *
 * @param {object} options - Options for the generation loop.
 * @param {string} options.task - High-level task name or identifier for the inference call.
 * @param {string} options.outputKind - Human-readable name for the kind of output being generated (used in errors).
 * @param {object} options.schema - A Zod schema object; must implement `safeParse` for output validation.
 * @param {string} options.prompt - Base prompt passed to the inference function; may be augmented with feedback between attempts.
 * @param {object} [options.context={}] - Arbitrary context passed through to inference and evaluators.
 * @param {object|null} [options.voiceProfile=null] - Optional voice/profile metadata passed through to inference and evaluators.
 * @param {Function} options.inference - Function called to produce provider output: receives `{ task, schema, prompt, context, attempt }`.
 * @param {Function[]|null} [options.evaluators=null] - Optional list of evaluator functions; defaults to narrator evaluator when omitted.
 * @param {Function} [options.normalizeOutput=(output)=>output] - Optional async sync function to normalize validated output before evaluation.
 * @param {number} [options.maxIterations=3] - Maximum number of generation attempts (at least 1).
 * @param {number} [options.minScore=0.86] - Minimum evaluator score required for a passing attempt.
 * @param {'best_effort'|'none'} [options.persistPolicy='best_effort'] - If `'best_effort'`, returns the highest-scoring attempt when no attempt passes.
 * @param {'live'|'off'} [options.evalMode='live'] - When `'off'`, evaluator execution is skipped and a passing report is synthesized.
 * @param {'syntax'|'none'} [options.linkCheck='syntax'] - Link-checking mode forwarded to evaluators.
 * @param {Function} [options.fetchImpl=globalThis.fetch] - Fetch implementation forwarded to evaluators when needed.
 *
 * @returns {object} An aggregated result object for the selected attempt containing:
 *  - `output`: the normalized, schema-validated output,
 *  - `provider`, `model`, `raw`: metadata and raw provider result,
 *  - `evalReport`: the final evaluator report object,
 *  - `evalScore`: numeric score from `evalReport.score`,
 *  - `evalStatus`: `'passed'` or `'best_effort'`,
 *  - `evalAttempts`: total number of attempts performed,
 *  - `attempts`: summary list of each attempt with `attempt`, `provider`, `model`, `evalScore`, and `evalStatus`.
 *
 * @throws {Error} If `inference` is not provided.
 * @throws {Error} If `schema.safeParse` is not available.
 * @throws {Error} If no attempt passes and `persistPolicy` is not `'best_effort'`.
 */
export async function runGeneratedOutputLoop({
  task,
  outputKind,
  schema,
  prompt,
  context = {},
  voiceProfile = null,
  inference,
  evaluators = null,
  normalizeOutput = (output) => output,
  maxIterations = 3,
  minScore = 0.86,
  persistPolicy = 'best_effort',
  evalMode = 'live',
  linkCheck = 'syntax',
  fetchImpl = globalThis.fetch
}) {
  if (!inference) throw new Error('runGeneratedOutputLoop requires an inference function.');
  if (!schema?.safeParse) throw new Error('runGeneratedOutputLoop requires a Zod schema.');
  const attempts = [];
  let best = null;
  let nextPrompt = prompt;

  for (let attempt = 1; attempt <= Math.max(1, maxIterations); attempt += 1) {
    const providerResult = await inference({
      task,
      schema,
      prompt: nextPrompt,
      context: {
        ...context,
        voiceProfile,
        previousEval: attempts.at(-1)?.evalReport ?? null
      },
      attempt
    });

    const output = validateSchemaOutput(schema, providerResult?.output, outputKind);
    const normalizedOutput = await normalizeOutput(output, {
      attempt,
      task,
      outputKind,
      context,
      voiceProfile,
      providerResult
    });

    const evalReport = evalMode === 'off'
      ? skippedEvalReport()
      : await runEvaluators({
        evaluators,
        outputKind,
        output: normalizedOutput,
        context,
        voiceProfile,
        attempt,
        linkCheck,
        fetchImpl,
        minScore
      });

    const attemptRecord = {
      attempt,
      output: normalizedOutput,
      provider: providerResult?.provider ?? null,
      model: providerResult?.model ?? null,
      raw: providerResult?.raw,
      evalReport
    };
    attempts.push(attemptRecord);

    if (!best || evalReport.score > best.evalReport.score) best = attemptRecord;

    if (reportPasses(evalReport, minScore)) {
      return resultFromAttempt(attemptRecord, attempts, 'passed');
    }

    if (attempt < Math.max(1, maxIterations)) {
      nextPrompt = promptWithFeedback(prompt, evalReport, { attempt, minScore });
    }
  }

  if (persistPolicy === 'best_effort' && best) {
    return resultFromAttempt(best, attempts, 'best_effort');
  }

  throw new Error(`Generated ${outputKind} output did not pass narrator evals after ${attempts.length} attempt(s).`);
}

/**
 * Validate and return parsed data from a Zod schema for generated output.
 *
 * @param {object} schema - A Zod schema object that provides `safeParse` for validation.
 * @param {*} output - The generated value to validate against the schema.
 * @param {string} outputKind - Human-readable name of the output type used in error messages.
 * @returns {*} The parsed/validated value.
 * @throws {Error} If validation fails, throws an error containing formatted schema validation details and the `outputKind`.
 */
function validateSchemaOutput(schema, output, outputKind) {
  const validation = schema.safeParse(output);
  if (validation.success) return validation.data;
  const details = typeof z.prettifyError === 'function'
    ? z.prettifyError(validation.error)
    : validation.error.message;
  throw new Error(`Generation loop could not produce schema-valid ${outputKind} output.\n${details}`);
}

/**
 * Run one or more evaluator functions against a generated output and combine their reports.
 *
 * @param {Object} params - Parameters for running evaluators.
 * @param {Function[]|null} params.evaluators - Optional array of evaluator functions; if empty or null a default narrator evaluator is used.
 * @param {string} params.outputKind - A short label describing the kind of output being evaluated (e.g., "narration", "transcript").
 * @param {*} params.output - The generated output to evaluate (already validated/normalized).
 * @param {Object} params.context - Caller-provided context passed through to evaluators.
 * @param {Object|null} params.voiceProfile - Optional voice/profile metadata passed to evaluators.
 * @param {number} params.attempt - The current generation attempt number (1-based).
 * @param {'syntax'|'none'|'full'} params.linkCheck - Link-checking mode to apply during evaluation.
 * @param {Function} params.fetchImpl - Fetch implementation to use for any network checks within evaluators.
 * @param {number} params.minScore - Minimum passing score used to derive verdicts.
 * @returns {Object} A combined evaluation report with:
 *  - `score`: numeric score in [0,1],
 *  - `verdict`: `'pass'` or `'fail'` (based on `minScore`),
 *  - `assertions`: flattened array of assertion records from evaluators,
 *  - `feedback`: flattened array of feedback items,
 *  - `requiredFixes`: flattened array of required fix descriptors,
 *  - `reports`: array of each evaluator's normalized report.
 */
async function runEvaluators({
  evaluators,
  outputKind,
  output,
  context,
  voiceProfile,
  attempt,
  linkCheck,
  fetchImpl,
  minScore
}) {
  const evaluatorList = Array.isArray(evaluators) && evaluators.length > 0
    ? evaluators
    : [evaluateNarratorOutput];

  const reports = [];
  for (const evaluator of evaluatorList) {
    reports.push(await evaluator({
      outputKind,
      output,
      context,
      voiceProfile,
      attempt,
      linkCheck,
      fetchImpl,
      minScore
    }));
  }

  if (reports.length === 1) return normalizeReport(reports[0], minScore);

  const normalized = reports.map((report) => normalizeReport(report, minScore));
  const score = normalized.reduce((sum, report) => sum + report.score, 0) / normalized.length;
  const assertions = normalized.flatMap((report) => report.assertions ?? []);
  const feedback = normalized.flatMap((report) => report.feedback ?? []);
  const requiredFixes = normalized.flatMap((report) => report.requiredFixes ?? []);
  return {
    score,
    verdict: score >= minScore ? 'pass' : 'fail',
    assertions,
    feedback,
    requiredFixes,
    reports: normalized
  };
}

/**
 * Normalize an evaluator report into a consistent structure with a clamped score and a derived verdict.
 *
 * @param {object} report - Evaluator report that may contain `score`, `verdict`, `assertions`, `feedback`, and `requiredFixes`.
 * @param {number} minScore - Minimum score required for a passing verdict.
 * @returns {{score: number, verdict: string, assertions: Array, feedback: Array, requiredFixes: Array}} Object with `score` clamped to [0,1], `verdict` (existing or determined by `score >= minScore`), and ensured arrays for `assertions`, `feedback`, and `requiredFixes`.
 */
function normalizeReport(report, minScore) {
  const score = clampScore(Number(report?.score ?? 0));
  return {
    score,
    verdict: report?.verdict ?? (score >= minScore ? 'pass' : 'fail'),
    assertions: report?.assertions ?? [],
    feedback: report?.feedback ?? [],
    requiredFixes: report?.requiredFixes ?? []
  };
}

/**
 * Create a fixed evaluation report indicating evaluation was skipped or disabled.
 *
 * @returns {{score: number, verdict: string, assertions: Array<object>, feedback: Array<unknown>, requiredFixes: Array<unknown>, skipped: boolean}}
 * An evaluation report object with `score` 1, `verdict` "pass", a single assertion
 * `{ name: "eval-disabled", text: "Narrator eval mode is off.", passed: true, score: 1 }`,
 * empty `feedback` and `requiredFixes` arrays, and `skipped: true`.
 */
function skippedEvalReport() {
  return {
    score: 1,
    verdict: 'pass',
    assertions: [{ name: 'eval-disabled', text: 'Narrator eval mode is off.', passed: true, score: 1 }],
    feedback: [],
    requiredFixes: [],
    skipped: true
  };
}

/**
 * Determine whether an evaluation report satisfies the pass criteria.
 * @param {{ score?: number, verdict?: string, requiredFixes?: any[] }} report - Evaluation report containing `score`, `verdict`, and optional `requiredFixes`.
 * @param {number} minScore - Minimum numeric score required to pass (inclusive).
 * @returns {boolean} `true` if `report.score` is greater than or equal to `minScore`, `report.verdict` is not `'fail'`, and `report.requiredFixes` is empty; `false` otherwise.
 */
function reportPasses(report, minScore) {
  return report.score >= minScore
    && report.verdict !== 'fail'
    && (report.requiredFixes ?? []).length === 0;
}

/**
 * Append evaluator findings and revision instructions to a base prompt.
 *
 * @param {string} basePrompt - The original prompt to augment.
 * @param {object} evalReport - Evaluation report containing at least `score`, and optionally `requiredFixes` and `feedback`.
 * @param {object} options
 * @param {number} options.attempt - The previous attempt number being reported.
 * @param {number} options.minScore - The minimum required evaluator score.
 * @returns {string} A combined prompt string that includes the base prompt followed by a summary of the previous attempt's score, required fixes, and evaluator feedback.
 */
function promptWithFeedback(basePrompt, evalReport, { attempt, minScore }) {
  return [
    basePrompt,
    '',
    `Previous narrator eval attempt ${attempt} scored ${evalReport.score.toFixed(2)}; required score is ${minScore.toFixed(2)}.`,
    'Revise the output to address these evaluator findings while preserving schema validity and source grounding.',
    '',
    'Required fixes:',
    JSON.stringify(evalReport.requiredFixes ?? [], null, 2),
    '',
    'Evaluator feedback:',
    JSON.stringify(evalReport.feedback ?? [], null, 2)
  ].join('\n');
}

/**
 * Build a standardized result object for a selected generation attempt.
 * @param {Object} attempt - The chosen attempt record.
 * @param {Array<Object>} attempts - All attempt records in chronological order.
 * @param {string} evalStatus - Final evaluation status label for the selected attempt (e.g., 'passed', 'best_effort', 'failed').
 * @returns {Object} An object summarizing the selected attempt and a compact summary of all attempts, containing:
 *   - output: normalized output from the selected attempt.
 *   - provider: provider identifier from the selected attempt.
 *   - model: model identifier from the selected attempt.
 *   - raw: raw provider result for the selected attempt.
 *   - evalReport: full evaluation report for the selected attempt.
 *   - evalScore: numeric evaluation score for the selected attempt.
 *   - evalStatus: the provided final status label.
 *   - evalAttempts: total number of attempts.
 *   - attempts: array of per-attempt summaries with fields: attempt (number), provider, model, evalScore, evalStatus (verdict).
 */
function resultFromAttempt(attempt, attempts, evalStatus) {
  return {
    output: attempt.output,
    provider: attempt.provider,
    model: attempt.model,
    raw: attempt.raw,
    evalReport: attempt.evalReport,
    evalScore: attempt.evalReport.score,
    evalStatus,
    evalAttempts: attempts.length,
    attempts: attempts.map((item) => ({
      attempt: item.attempt,
      provider: item.provider,
      model: item.model,
      evalScore: item.evalReport.score,
      evalStatus: item.evalReport.verdict
    }))
  };
}

/**
 * Clamp a numeric score into the [0, 1] range.
 * @param {number} value - The numeric value to clamp.
 * @returns {number} The input clamped to the range 0 to 1; returns 0 if `value` is not a finite number.
 */
function clampScore(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
