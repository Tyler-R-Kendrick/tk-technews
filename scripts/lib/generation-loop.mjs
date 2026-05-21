import { z } from 'zod';
import { evaluateNarratorOutput } from './narrator-voice-evals.mjs';

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

function validateSchemaOutput(schema, output, outputKind) {
  const validation = schema.safeParse(output);
  if (validation.success) return validation.data;
  const details = typeof z.prettifyError === 'function'
    ? z.prettifyError(validation.error)
    : validation.error.message;
  throw new Error(`Generation loop could not produce schema-valid ${outputKind} output.\n${details}`);
}

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

function reportPasses(report, minScore) {
  return report.score >= minScore
    && report.verdict !== 'fail'
    && (report.requiredFixes ?? []).length === 0;
}

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

function clampScore(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
