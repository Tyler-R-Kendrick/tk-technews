import { briefSourceDoc, enrichSourceDoc, ingestSourceUri } from './lib/durable-pipeline.mjs';

const args = parseArgs(process.argv.slice(2));
const uri = args.uri ?? args._[0];
if (!uri) throw new Error('Usage: npm run pipeline:source -- --uri https://example.com/article');

const ingest = await ingestSourceUri(uri, { force: args.force === 'true' });
if (ingest.sourceDoc?.status !== 'parsed') {
  console.log(JSON.stringify({
    status: ingest.sourceDoc?.status,
    sourceDocId: ingest.sourceDoc?.id,
    reasonCode: ingest.sourceDoc?.reasonCode,
    reasonDetail: ingest.sourceDoc?.reasonDetail
  }, null, 2));
  process.exit(0);
}

const brief = await briefSourceDoc({ sourceDocId: ingest.sourceDoc.id });
if (brief.status !== 'briefed') {
  console.log(JSON.stringify({ status: brief.status, sourceDocId: ingest.sourceDoc.id, reasonCode: brief.reasonCode }, null, 2));
  process.exit(0);
}

const enriched = await enrichSourceDoc({ sourceDocId: ingest.sourceDoc.id });
console.log(JSON.stringify({
  sourceDocId: ingest.sourceDoc.id,
  briefId: brief.id,
  enrichedDocId: enriched.id,
  status: enriched.status
}, null, 2));

function parseArgs(argv) {
  const parsed = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      parsed._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    parsed[key] = next && !next.startsWith('--') ? next : 'true';
    if (next && !next.startsWith('--')) index += 1;
  }
  return parsed;
}
