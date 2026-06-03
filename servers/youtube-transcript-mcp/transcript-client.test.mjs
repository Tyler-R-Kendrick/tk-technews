import test from 'node:test';
import assert from 'node:assert/strict';
import { runProcess } from './transcript-client.mjs';

test('runProcess returns stdout for a successful child process', async () => {
  const result = await runProcess({
    command: process.execPath,
    args: ['-e', "process.stdout.write('ok')"],
    stdin: ''
  }, {
    timeoutMs: 2000
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, 'ok');
});

test('runProcess times out long-running child processes', async () => {
  const result = await runProcess({
    command: process.execPath,
    args: ['-e', 'setTimeout(() => {}, 10_000)'],
    stdin: ''
  }, {
    timeoutMs: 100
  });

  assert.equal(result.exitCode, -1);
  assert.match(result.stderr, /timed out/i);
});
