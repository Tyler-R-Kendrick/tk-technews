import assert from 'node:assert/strict';
import test from 'node:test';
import packageJson from '../package.json' with { type: 'json' };

test('daily generation refreshes monitored sources before writing article stubs', () => {
  const script = packageJson.scripts['daily:generate'];

  assert.match(script, /precompile:sources/);
  assert.match(script, /generate-daily-articles\.mjs/);
  assert.ok(script.indexOf('precompile:sources') < script.indexOf('generate-daily-articles.mjs'));
});
