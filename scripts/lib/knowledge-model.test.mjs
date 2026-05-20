import test from 'node:test';
import assert from 'node:assert/strict';
import { extractKnowledgeModel } from './knowledge-model.mjs';

test('extracts cited entities, topics, claims, and relationships from summaries', () => {
  const ledger = {
    generatedAt: '2026-05-19T12:00:00.000Z',
    items: [
      {
        id: 'source-1',
        sourceName: 'Example Source',
        title: 'OpenAI ships agent tools',
        url: 'https://example.com/openai-agent-tools',
        summary: 'OpenAI announced new agent tools for developers. Microsoft said the tools will connect to Azure services.',
        tags: ['ai', 'agents'],
        status: 'ok'
      },
      {
        id: 'source-2',
        sourceName: 'Second Source',
        title: 'Developers compare agent platforms',
        url: 'https://example.com/agent-platforms',
        summary: 'Developers compared OpenAI and Google platforms. Google described Gemini as a workspace assistant.',
        tags: ['ai', 'platforms'],
        status: 'ok'
      }
    ]
  };

  const model = extractKnowledgeModel(ledger, { generatedAt: '2026-05-19T13:00:00.000Z' });

  assert.equal(model.generatedAt, '2026-05-19T13:00:00.000Z');
  assert.equal(model.sources.length, 2);
  assert.deepEqual(model.topics.map((topic) => topic.name), ['ai', 'agents', 'platforms']);
  assert.ok(model.entities.some((entity) => entity.name === 'OpenAI' && entity.evidenceIds.includes('source-1')));
  assert.ok(model.entities.some((entity) => entity.name === 'Google' && entity.evidenceIds.includes('source-2')));
  assert.ok(model.claims.every((claim) => claim.citation.url.startsWith('https://example.com/')));
  assert.ok(model.relationships.some((relationship) => relationship.entities.includes('OpenAI') && relationship.entities.includes('Microsoft')));
});

test('skips failed summaries and limits extracted claims per source', () => {
  const ledger = {
    items: [
      {
        id: 'ok',
        sourceName: 'Example',
        title: 'Title',
        url: 'https://example.com/ok',
        summary: 'First useful claim. Second useful claim. Third useful claim. Fourth useful claim.',
        tags: [],
        status: 'ok'
      },
      {
        id: 'failed',
        sourceName: 'Example',
        title: 'Failure',
        url: 'https://example.com/fail',
        summary: 'This should not appear.',
        tags: ['ignored'],
        status: 'error'
      }
    ]
  };

  const model = extractKnowledgeModel(ledger, { maxClaimsPerSource: 2 });

  assert.deepEqual(model.sources.map((source) => source.id), ['ok']);
  assert.equal(model.claims.length, 2);
  assert.equal(model.topics.length, 0);
});

test('does not promote feed metadata labels into entities', () => {
  const ledger = {
    items: [
      {
        id: 'hn',
        sourceName: 'Hacker News',
        title: 'New accessibility features powered by Apple Intelligence',
        url: 'https://example.com/apple-accessibility',
        summary: 'Article URL: https://example.com/apple-accessibility Comments URL: https://news.ycombinator.com/item?id=1 Points: 87 # Comments: 21 Apple described new accessibility updates.',
        tags: ['accessibility'],
        status: 'ok'
      }
    ]
  };

  const model = extractKnowledgeModel(ledger);
  const names = model.entities.map((entity) => entity.name);

  assert.ok(names.includes('Apple Intelligence'));
  assert.ok(!names.includes('Article URL'));
  assert.ok(!names.includes('Comments URL'));
  assert.ok(!names.includes('Points'));
  assert.ok(!names.includes('Comments'));
});
