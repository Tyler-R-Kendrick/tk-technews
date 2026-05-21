import test from 'node:test';
import assert from 'node:assert/strict';
import { runNarratorFixture } from './agentv-narrator-provider.mjs';

test('AgentV narrator provider returns an article fixture with passing eval metadata', async () => {
  const result = await runNarratorFixture('article-pass');

  assert.equal(result.outputKind, 'article');
  assert.equal(result.voiceProfile.id, 'tk-technews-journalist');
  assert.equal(result.evalStatus, 'passed');
  assert.equal(result.evalAttempts, 1);
  assert.ok(result.evalScore >= 0.86);
  assert.ok(result.evalReport.assertions.some((assertion) => assertion.name === 'tone-match'));
  assert.ok(result.evalReport.assertions.some((assertion) => assertion.name === 'word-choice'));
  assert.ok(result.evalReport.assertions.some((assertion) => assertion.name === 'detail-level'));
});

test('AgentV narrator provider exercises the refinement loop for weak article drafts', async () => {
  const result = await runNarratorFixture('article-refine');

  assert.equal(result.outputKind, 'article');
  assert.equal(result.evalStatus, 'passed');
  assert.equal(result.evalAttempts, 2);
  assert.match(result.output.markdownBody, /Speculative applied opportunity/);
});

test('AgentV narrator provider returns a grounded wiki fixture', async () => {
  const result = await runNarratorFixture('wiki-pass');

  assert.equal(result.outputKind, 'wiki');
  assert.equal(result.voiceProfile.id, 'tk-technews-wiki');
  assert.equal(result.evalStatus, 'passed');
  assert.equal(result.output.pages[0].citations[0].url, 'https://example.com/agents');
});

test('AgentV narrator provider exposes hard-science and wiki voice fixtures separately', async () => {
  const article = await runNarratorFixture('article-hard-science');
  const wiki = await runNarratorFixture('wiki-reference');

  assert.equal(article.outputKind, 'article');
  assert.equal(article.voiceProfile.tone, 'journalistic-hard-science');
  assert.equal(article.evalStatus, 'passed');
  assert.match(article.output.markdownBody, /mechanism|constraint|measurement|evidence/i);

  assert.equal(wiki.outputKind, 'wiki');
  assert.equal(wiki.voiceProfile.tone, 'reference');
  assert.equal(wiki.evalStatus, 'passed');
  assert.doesNotMatch(JSON.stringify(wiki.output.pages[0]), /phase transition|first-principles|verdict/i);
});
