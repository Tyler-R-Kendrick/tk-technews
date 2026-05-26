import test from 'node:test';
import assert from 'node:assert/strict';
import { runDailySocialFixture } from './agentv-daily-social-provider.mjs';

test('AgentV daily social fixture keeps retweet quote content in rich previews', async () => {
  const result = await runDailySocialFixture('retweet-quote');
  const stub = result.stub;
  const generatedText = [
    stub.dek,
    ...stub.bodySections.flatMap((section) => section.paragraphs),
    ...stub.keyTakeaways
  ].join('\n');
  const retweet = stub.sources.find((source) => source.preview?.social?.kind === 'retweet');

  assert.ok(retweet);
  assert.equal(retweet.preview.label, 'Retweet');
  assert.equal(retweet.preview.social.originalAuthor, 'elvis');
  assert.equal(retweet.preview.social.quotedUrl, 'https://www.intology.ai/blog/nanogpt-bench');
  assert.doesNotMatch(generatedText, /\bRT\b|elvisVery|Read more here:\s*https?:\/\//i);
});

test('AgentV daily quality fixture uses generation loop for substantive article content', async () => {
  const result = await runDailySocialFixture('title-echo-quality');
  const stub = result.stub;
  const generatedText = [
    stub.dek,
    ...stub.bodySections.flatMap((section) => [section.heading, ...section.paragraphs]),
    ...stub.keyTakeaways
  ].join('\n');

  assert.equal(stub.evalStatus, 'passed');
  assert.equal(stub.provider, 'deterministic-daily-journalist');
  assert.ok(stub.evalScore >= 0.86);
  assert.ok(stub.bodySections.length >= 2);
  assert.ok(generatedText.split(/\s+/).length >= 150);
  assert.doesNotMatch(generatedText, /Changes The Practical Tradeoff|^Openai Cheap Could Derail Google:/m);
});

test('AgentV source grounding fixture fails closed when source text extraction is empty', async () => {
  const result = await runDailySocialFixture('source-grounding-regression');
  const stub = result.stub;
  const generatedText = [
    stub.dek,
    ...stub.bodySections.flatMap((section) => [section.heading, ...section.paragraphs]),
    ...stub.keyTakeaways
  ].join('\n');

  assert.equal(stub.evalStatus, 'best_effort');
  assert.equal(stub.status, 'best_effort');
  assert.doesNotMatch(generatedText, /measurement problem|source set|daily feed|cited source signal|if this source is accurate/i);
  assert.ok(stub.evalReport.requiredFixes.some((fix) => /usable extracted source text|usable source|grounded|instruction|source metadata/i.test(fix)));
});
