import { readFile } from 'node:fs/promises';
import { evaluateNarratorOutput } from '../../../scripts/lib/narrator-voice-evals.mjs';

const payload = JSON.parse(await readStdin());
const candidate = await parseCandidate(payload);
const report = await evaluateNarratorOutput({
  outputKind: candidate.outputKind,
  output: candidate.output,
  context: candidate.context ?? {},
  voiceProfile: candidate.voiceProfile ?? {},
  linkCheck: candidate.linkCheck ?? 'syntax'
});

console.log(JSON.stringify({
  score: report.score,
  assertions: report.assertions.map((assertion) => ({
    text: assertion.text,
    passed: assertion.passed,
    evidence: assertion.name
  })),
  details: {
    verdict: report.verdict,
    requiredFixes: report.requiredFixes,
    feedback: report.feedback,
    loopEvalStatus: candidate.evalStatus ?? null,
    loopEvalScore: candidate.evalScore ?? null,
    loopEvalAttempts: candidate.evalAttempts ?? null
  }
}, null, 2));

/**
 * Parse a narrator candidate from the grader payload by extracting candidate content and parsing it as JSON.
 *
 * @param {Object} payload - Grader payload containing candidate data. Expected to include `output` (inline messages) or `output_path` (file path) to locate the candidate output.
 * @returns {Object} The parsed candidate object. Must include `outputKind` and `output`; may also include `context`, `voiceProfile`, `linkCheck`, and loop-eval metadata.
 * @throws {Error} If the parsed candidate is missing `outputKind` or `output`.
 */
async function parseCandidate(payload) {
  const content = await contentFromOutput(payload.output, payload.output_path);
  const parsed = JSON.parse(content);
  if (!parsed.outputKind || !parsed.output) {
    throw new Error('Narrator candidate must include outputKind and output.');
  }
  return parsed;
}

/**
 * Extracts and returns candidate output text from an array of messages or from a file.
 * @param {any} output - Expected to be an array of message objects; each message may have a string `content` field. If not an array, it is treated as empty.
 * @param {string} [outputPath] - Filesystem path to read content from if no inline message content is present.
 * @return {Promise<string>} The candidate output content as a single string.
 * @throws {Error} If no inline content is found and `outputPath` is not provided or yields no content.
 */
async function contentFromOutput(output, outputPath) {
  const messages = Array.isArray(output) ? output : [];
  const content = messages
    .map((message) => typeof message?.content === 'string' ? message.content : '')
    .filter(Boolean)
    .join('\n');
  if (content) return content;
  if (outputPath) return readFile(outputPath, 'utf8');
  throw new Error('AgentV grader payload did not include candidate output.');
}

/**
 * Read all data from standard input and return it as a UTF-8 string.
 * @returns {Promise<string>} The collected stdin string.
 */
function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}
