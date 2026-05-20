import { enrichSourceDoc } from './lib/durable-pipeline.mjs';

const args = parseArgs(process.argv.slice(2));
const sourceDocId = args['source-doc-id'];
if (!sourceDocId) throw new Error('Usage: npm run source:enrich -- --source-doc-id source-doc:...');

const enriched = await enrichSourceDoc({ sourceDocId });
console.log(JSON.stringify({
  id: enriched.id,
  status: enriched.status,
  reasonCode: enriched.reasonCode,
  appliedOpportunities: enriched.appliedOpportunities?.length ?? 0
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
