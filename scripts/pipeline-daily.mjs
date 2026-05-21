import { aggregateEnrichedDocsForDate, generateArticleFromAggregate, localDateForIso } from './lib/durable-pipeline.mjs';

const args = parseArgs(process.argv.slice(2));
const date = args.date ?? localDateForIso(new Date().toISOString());
const aggregate = await aggregateEnrichedDocsForDate({ date });
const article = await generateArticleFromAggregate({
  aggregateId: aggregate.id,
  voice: args.voice ?? 'tk-technews-journalist',
  evalMode: args['eval-mode'] ?? 'live',
  maxEvalIterations: numberArg(args['max-eval-iterations'], 3),
  minEvalScore: numberArg(args['min-eval-score'], 0.86),
  linkCheck: args['link-check'] ?? 'syntax'
});

console.log(JSON.stringify({
  aggregateBriefId: aggregate.id,
  articleId: article.id,
  slug: article.slug,
  markdownPath: article.markdownPath,
  evalStatus: article.evalStatus,
  evalScore: article.evalScore,
  evalAttempts: article.evalAttempts
}, null, 2));

/**
 * Parse an argv-style array into an object of `--key value` pairs.
 *
 * For each element beginning with `--`, the token after the `--` is used as the key
 * and the following array element is assigned as its value. Later occurrences of
 * the same key override earlier ones.
 *
 * @param {string[]} argv - Command-line arguments (e.g., process.argv.slice(2)).
 * @returns {Object<string, string|undefined>} An object mapping keys to their string values (or `undefined` if a value is missing).
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
 * Parse a value as a finite number, falling back to a default when parsing fails.
 * @param {*} value - The value to convert to a number; may be a string, number, or other type.
 * @param {number} fallback - The number to return if `value` is `undefined` or does not convert to a finite number.
 * @returns {number} The parsed finite number, or `fallback` if parsing yields `NaN`, `Infinity`, `-Infinity`, or if `value` is `undefined`.
 */
function numberArg(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
