import { generateArticleFromAggregate } from './lib/durable-pipeline.mjs';

const args = parseArgs(process.argv.slice(2));
const aggregateId = args['aggregate-id'];
const voice = args.voice ?? 'tk-technews';
if (!aggregateId) throw new Error('Usage: npm run article:generate -- --aggregate-id aggregate-brief:... [--voice tk-technews]');

const article = await generateArticleFromAggregate({ aggregateId, voice });
console.log(JSON.stringify({
  id: article.id,
  status: article.status,
  slug: article.slug,
  markdownPath: article.markdownPath
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
