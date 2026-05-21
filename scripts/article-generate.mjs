import { generateArticleFromAggregate } from './lib/durable-pipeline.mjs';

const args = parseArgs(process.argv.slice(2));
const aggregateId = args['aggregate-id'];
const voice = args.voice ?? 'tk-technews-journalist';
if (!aggregateId) throw new Error('Usage: npm run article:generate -- --aggregate-id aggregate-brief:... [--voice tk-technews-journalist]');

const article = await generateArticleFromAggregate({
  aggregateId,
  voice,
  evalMode: args['eval-mode'] ?? 'live',
  maxEvalIterations: numberArg(args['max-eval-iterations'], 3),
  minEvalScore: numberArg(args['min-eval-score'], 0.86),
  linkCheck: args['link-check'] ?? 'syntax'
});
console.log(JSON.stringify({
  id: article.id,
  status: article.status,
  slug: article.slug,
  markdownPath: article.markdownPath,
  evalStatus: article.evalStatus,
  evalScore: article.evalScore,
  evalAttempts: article.evalAttempts
}, null, 2));

/**
 * Parse command-line-style `--key value` pairs into an object.
 * @param {string[]} argv - Array of command-line arguments (e.g., process.argv.slice(2)).
 * @returns {Object<string,string|undefined>} An object mapping keys (without the leading `--`) to their corresponding string values; if a key has no following value, its value will be `undefined`.
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
 * Parse a CLI numeric argument and yield a finite number or a fallback.
 * @param {string|undefined} value - The raw argument value to parse as a number.
 * @param {number} fallback - Value to return when `value` is undefined or cannot be parsed to a finite number.
 * @returns {number} The parsed finite number from `value`, or `fallback` if parsing fails.
 */
function numberArg(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
