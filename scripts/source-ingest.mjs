import { ingestSourceUri } from './lib/durable-pipeline.mjs';

const args = parseArgs(process.argv.slice(2));
const uri = args.uri ?? args._[0];
if (!uri) throw new Error('Usage: npm run source:ingest -- --uri https://example.com/article');

const result = await ingestSourceUri(uri, {
  force: args.force === 'true'
});

console.log(JSON.stringify({
  status: result.status,
  resolverStatus: result.resolverStatus,
  sourceDocId: result.sourceDoc?.id,
  reasonCode: result.sourceDoc?.reasonCode,
  reasonDetail: result.sourceDoc?.reasonDetail
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
