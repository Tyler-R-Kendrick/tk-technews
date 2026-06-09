import { ensureLocalRuntimeDeps } from './lib/local-runtime-deps.mjs';

const result = ensureLocalRuntimeDeps(process.cwd());
console.log(JSON.stringify({
  status: 'ok',
  repairs: result.repairs
}, null, 2));
