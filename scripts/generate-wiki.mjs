import { generateWikiFromKnowledgeGraph } from './lib/wiki-generator.mjs';

const args = parseArgs(process.argv.slice(2));
const wiki = await generateWikiFromKnowledgeGraph({
  root: process.cwd(),
  voice: args.voice ?? 'tk-technews-wiki',
  evalMode: args['eval-mode'] ?? 'live',
  maxEvalIterations: numberArg(args['max-eval-iterations'], 3),
  minEvalScore: numberArg(args['min-eval-score'], 0.86),
  linkCheck: args['link-check'] ?? 'syntax'
});

console.log(`Generated knowledge graph wiki: ${wiki.pages.length} page(s), graph ${wiki.graphHash}`);
console.log(`Narrator eval: ${wiki.cache?.evalStatus ?? 'unknown'} (${wiki.cache?.evalScore ?? 'n/a'}, ${wiki.cache?.evalAttempts ?? 0} attempt(s))`);
console.log('Wrote src/data/wiki/generated-wiki.json and public/wiki/generated-wiki.json');

/**
 * Parse an array of CLI tokens into a map of `--key value` pairs.
 *
 * @param {string[]} argv - Array of command-line arguments (e.g., `process.argv.slice(2)`).
 * @returns {Object<string, string|undefined>} An object whose keys are flag names (without the leading `--`) and whose values are the token immediately following each flag; flags without a following token map to `undefined`. Tokens not starting with `--` are ignored.
 */
function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]?.startsWith('--') ? argv[index].slice(2) : null;
    if (!key) continue;
    parsed[key] = argv[index + 1];
    index += 1;
  }
  return parsed;
}

/**
 * Parse a value into a finite number or return a fallback.
 *
 * Attempts to convert `value` to a number and returns it when finite.
 * If `value` is `undefined`, cannot be parsed, is `NaN`, or is infinite, `fallback` is returned.
 *
 * @param {*} value - The input to parse (commonly a string or number).
 * @param {number} fallback - The number to return when parsing fails or `value` is `undefined`.
 * @returns {number} The parsed finite number, or `fallback` if parsing did not produce a finite number.
 */
function numberArg(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
