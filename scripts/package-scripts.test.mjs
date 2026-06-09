import assert from 'node:assert/strict';
import test from 'node:test';
import packageJson from '../package.json' with { type: 'json' };

test('daily generation refreshes monitored sources before writing article stubs', () => {
  const script = packageJson.scripts['daily:generate'];

  assert.match(script, /precompile:sources/);
  assert.match(script, /generate-daily-articles\.mjs/);
  assert.ok(script.indexOf('precompile:sources') < script.indexOf('generate-daily-articles.mjs'));
});

test('agentic daily source workflow uses guarded runner script', () => {
  assert.equal(
    packageJson.scripts['daily:agentic'],
    'node scripts/run-daily-source-generation.mjs'
  );
});

test('dependency preparation uses the repo-local repair script', () => {
  assert.equal(
    packageJson.scripts['deps:prepare'],
    'node scripts/ensure-local-runtime-deps.mjs'
  );
});

test('daily verification uses the targeted daily test suite', () => {
  assert.match(packageJson.scripts['test:daily'], /daily-archive\.test\.mjs/);
  assert.match(packageJson.scripts['test:daily'], /daily-article-stubs\.test\.mjs/);
  assert.doesNotMatch(packageJson.scripts['test:daily'], /agentv-source-grounding-sdk\.test\.ts/);
});
