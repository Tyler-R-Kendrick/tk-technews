import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { persistWeeklyLedgerToKnowledgeGraph } from './weekly-graph-persistence.mjs';

test('persists weekly summaries and extracted knowledge into the temporal graph', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tk-weekly-graph-'));
  await fs.mkdir(path.join(root, 'data', 'summaries'), { recursive: true });
  await fs.mkdir(path.join(root, 'data', 'knowledge'), { recursive: true });
  await fs.writeFile(path.join(root, 'data', 'summaries', 'latest.json'), JSON.stringify({
    generatedAt: '2026-05-20T18:00:00.000Z',
    items: [{
      id: 'weekly-openai-agents',
      sourceId: 'google-news-openai',
      sourceName: 'OpenAI News',
      kind: 'googleNews',
      title: 'OpenAI agent workflows',
      url: 'https://example.com/openai-agents',
      publishedAt: '2026-05-18T12:00:00.000Z',
      fetchedAt: '2026-05-20T18:00:00.000Z',
      summary: 'OpenAI released agent workflows for developers.',
      tags: ['ai', 'agents'],
      status: 'ok'
    }]
  }, null, 2));
  await fs.writeFile(path.join(root, 'data', 'knowledge', 'latest.json'), JSON.stringify({
    claims: [{
      id: 'weekly-openai-agents:claim-1',
      text: 'OpenAI released agent workflows for developers.',
      evidenceId: 'weekly-openai-agents',
      citation: { title: 'OpenAI agent workflows', source: 'OpenAI News', url: 'https://example.com/openai-agents' },
      tags: ['ai', 'agents']
    }],
    entities: [{
      name: 'OpenAI',
      evidenceIds: ['weekly-openai-agents'],
      citations: [{ title: 'OpenAI agent workflows', source: 'OpenAI News', url: 'https://example.com/openai-agents' }]
    }],
    topics: [{
      name: 'agents',
      evidenceIds: ['weekly-openai-agents'],
      citations: [{ title: 'OpenAI agent workflows', source: 'OpenAI News', url: 'https://example.com/openai-agents' }]
    }],
    relationships: [{
      type: 'co-mentioned',
      entities: ['OpenAI', 'Developers'],
      evidenceIds: ['weekly-openai-agents'],
      citations: [{ title: 'OpenAI agent workflows', source: 'OpenAI News', url: 'https://example.com/openai-agents' }]
    }]
  }, null, 2));

  const result = await persistWeeklyLedgerToKnowledgeGraph({ root });

  assert.equal(result.sourceDocs, 1);
  assert.equal(result.claims, 1);
  assert.equal(result.entities, 1);
  assert.equal(result.topics, 1);

  const graph = JSON.parse(await fs.readFile(path.join(root, 'data', 'graph', 'kg.jsonld'), 'utf8'));
  assert.ok(graph['@graph'].some((node) => node['@type'] === 'SourceDocument'));
  assert.ok(graph['@graph'].some((node) => node['@type'] === 'Claim'));
  assert.ok(graph['@graph'].some((node) => node['@type'] === 'Entity' && node.name === 'OpenAI'));
  assert.ok(graph['@graph'].some((edge) => edge['@type'] === 'supportsClaim'));
});
