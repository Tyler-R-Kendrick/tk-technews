import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ingestScript = path.join(repoRoot, 'scripts', 'ingest.mjs');

test('records failed source ingestion outside the summary item list', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tk-technews-ingest-'));

  try {
    await fs.mkdir(path.join(root, 'data'), { recursive: true });
    await fs.writeFile(path.join(root, 'data', 'sources.json'), JSON.stringify({
      rss: [
        {
          id: 'broken-feed',
          name: 'Broken Feed',
          url: 'http://127.0.0.1:9/feed.xml',
          topicTags: ['test']
        }
      ],
      web: [
        {
          id: 'broken-web',
          name: 'Broken Web',
          url: 'http://127.0.0.1:9/',
          topicTags: ['test']
        }
      ]
    }, null, 2));

    await execFileAsync(process.execPath, [ingestScript], { cwd: root });

    const ledger = JSON.parse(await fs.readFile(path.join(root, 'data', 'summaries', 'latest.json'), 'utf8'));
    assert.equal(ledger.sourceCount, 2);
    assert.equal(ledger.itemCount, 0);
    assert.deepEqual(ledger.items, []);
    assert.deepEqual(ledger.sourceErrors.map((entry) => entry.sourceId).sort(), ['broken-feed', 'broken-web']);
    assert.ok(ledger.sourceErrors.every((entry) => entry.status === 'error'));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
