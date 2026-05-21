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

function numberArg(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
