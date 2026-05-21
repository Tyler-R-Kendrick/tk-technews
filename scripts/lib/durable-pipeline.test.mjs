import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import {
  appendLedgerRecord,
  canonicalizeUri,
  latestRecordById,
  readLedger,
  sourceDocIdForUri
} from './ledger-store.mjs';
import {
  addArtifactToGraph,
  findRelatedGraphContext,
  graphFromRecords,
  toJsonLd
} from './temporal-knowledge-graph.mjs';
import {
  defaultProviders,
  generateStructuredObject,
  InferenceUnavailableError
} from './inference.mjs';
import {
  aggregateEnrichedDocsForDate,
  generateArticleFromAggregate,
  ingestSourceUri,
  revisitPendingRecord,
  sourceNeedsRetry
} from './durable-pipeline.mjs';

test('canonicalizes URIs and derives stable source document ids', () => {
  assert.equal(
    canonicalizeUri('HTTPS://Example.com:443/path/?b=2&a=1#fragment'),
    'https://example.com/path/?a=1&b=2'
  );
  assert.match(sourceDocIdForUri('https://example.com/path/?a=1&b=2'), /^source-doc:[a-f0-9]{16}$/);
  assert.equal(
    sourceDocIdForUri('https://example.com/path/?b=2&a=1#frag'),
    sourceDocIdForUri('https://example.com/path/?a=1&b=2')
  );
});

test('append-only ledger returns latest record by id', async () => {
  const root = await tempRoot();
  await appendLedgerRecord(root, 'source-docs', { id: 'source-doc:1', status: 'discovered', revision: 1 });
  await appendLedgerRecord(root, 'source-docs', { id: 'source-doc:1', status: 'parsed', revision: 2 });

  assert.equal((await readLedger(root, 'source-docs')).length, 2);
  assert.deepEqual(await latestRecordById(root, 'source-docs', 'source-doc:1'), {
    id: 'source-doc:1',
    status: 'parsed',
    revision: 2
  });
});

test('graph stores temporal multimodal nodes and JSON-LD edges', () => {
  const sourceDoc = {
    id: 'source-doc:1',
    type: 'SourceDocument',
    title: 'A useful source',
    canonicalUri: 'https://example.com/a',
    publishedAt: '2026-05-20T10:00:00.000Z',
    observedAt: '2026-05-20T12:00:00.000Z',
    ingestedAt: '2026-05-20T12:01:00.000Z',
    status: 'parsed',
    textSpans: [
      {
        id: 'text-span:1',
        text: 'OpenAI shipped an agent feature.',
        citation: {
          title: 'A useful source',
          url: 'https://example.com/a#span-1',
          source: 'Example'
        }
      }
    ],
    media: {
      images: [{ id: 'image:1', uri: 'https://example.com/image.png', alt: 'diagram' }],
      videos: [{ id: 'video:1', uri: 'https://example.com/video.mp4', title: 'demo' }]
    }
  };

  const graph = addArtifactToGraph(graphFromRecords([]), sourceDoc);
  const jsonLd = toJsonLd(graph);

  assert.ok(jsonLd['@graph'].some((node) => node['@id'] === 'source-doc:1' && node['@type'] === 'SourceDocument'));
  assert.ok(jsonLd['@graph'].some((node) => node['@id'] === 'text-span:1' && node['@type'] === 'TextSpan'));
  assert.ok(jsonLd['@graph'].some((node) => node['@id'] === 'image:1' && node['@type'] === 'ImageAsset'));
  assert.ok(jsonLd['@graph'].some((edge) => edge['@type'] === 'hasModality' && edge.from === 'source-doc:1' && edge.to === 'image:1'));
  assert.ok(jsonLd['@graph'].some((edge) => edge['@type'] === 'hasTemporalScope' && edge.from === 'source-doc:1'));
});

test('failed parse creates revisit_pending and resolver skips full retry while blocked', async () => {
  const root = await tempRoot();
  const uri = 'https://example.com/empty';
  const first = await ingestSourceUri(uri, {
    root,
    now: '2026-05-20T12:00:00.000Z',
    fetchImpl: async () => new Response('<html><main></main></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' }
    })
  });

  assert.equal(first.sourceDoc.status, 'revisit_pending');
  assert.equal(first.sourceDoc.reasonCode, 'parse_empty_text');

  let attemptedFullFetch = false;
  const second = await ingestSourceUri(uri, {
    root,
    now: '2026-05-20T12:05:00.000Z',
    fetchImpl: async (_url, init = {}) => {
      if (init.method !== 'HEAD') attemptedFullFetch = true;
      return new Response('', { status: 200, headers: { 'content-type': 'text/html' } });
    }
  });

  assert.equal(second.status, 'revisit_pending');
  assert.equal(second.resolverStatus, 'still_blocked');
  assert.equal(attemptedFullFetch, false);
});

test('parsed source documents are persisted with citation-addressable spans and graph nodes', async () => {
  const root = await tempRoot();
  const result = await ingestSourceUri('https://example.com/story', {
    root,
    now: '2026-05-20T12:00:00.000Z',
    fetchImpl: async () => new Response(`
      <html>
        <head><title>Agent systems update</title><meta property="og:image" content="/hero.png"></head>
        <body><main><p>OpenAI shipped an agent workflow for developers.</p><p>Teams can use it to automate review loops.</p></main></body>
      </html>
    `, { status: 200, headers: { 'content-type': 'text/html' } })
  });

  assert.equal(result.sourceDoc.status, 'parsed');
  assert.equal(result.sourceDoc.textSpans.length, 2);
  assert.equal(result.sourceDoc.textSpans[0].citation.url, 'https://example.com/story#span-1');
  assert.equal((await latestRecordById(root, 'source-docs', result.sourceDoc.id)).status, 'parsed');

  const graph = JSON.parse(await fs.readFile(path.join(root, 'data', 'graph', 'kg.jsonld'), 'utf8'));
  assert.ok(graph['@graph'].some((node) => node['@type'] === 'SourceDocument' && node['@id'] === result.sourceDoc.id));
});

test('inference uses provider fallback and validates structured JSON', async () => {
  const schema = z.object({ summary: z.string(), citations: z.array(z.object({ url: z.string() })) });
  const result = await generateStructuredObject({
    task: 'source brief',
    schema,
    prompt: 'Summarize this source.',
    providers: [
      { name: 'primary', available: async () => true, generate: async () => { throw new Error('nope'); } },
      { name: 'codex', available: async () => true, generate: async () => '{"summary":"Brief","citations":[{"url":"https://example.com"}]}' }
    ]
  });

  assert.equal(result.provider, 'codex');
  assert.deepEqual(result.output, { summary: 'Brief', citations: [{ url: 'https://example.com' }] });
});

test('default inference providers include GitHub Copilot after Codex fallback', () => {
  assert.deepEqual(defaultProviders().map((provider) => provider.name), [
    'ai-sdk',
    'codex',
    'github-copilot'
  ]);
});

test('inference fails with inference_unavailable when no provider is usable', async () => {
  await assert.rejects(
    () => generateStructuredObject({
      task: 'source brief',
      schema: z.object({ ok: z.boolean() }),
      prompt: 'Do work.',
      providers: [{ name: 'missing', available: async () => false, generate: async () => '{}' }]
    }),
    InferenceUnavailableError
  );
});

test('graph context finds related claims, entities, topics, and temporal neighbors', () => {
  const graph = graphFromRecords([
    {
      id: 'claim:1',
      type: 'Claim',
      text: 'OpenAI released an agent workflow.',
      entities: ['OpenAI'],
      topics: ['agents'],
      observedAt: '2026-05-20T12:00:00.000Z',
      citations: [{ url: 'https://example.com/1', title: 'One', source: 'Example' }]
    },
    {
      id: 'entity:openai',
      type: 'Entity',
      name: 'OpenAI',
      observedAt: '2026-05-20T11:00:00.000Z'
    }
  ]);

  const context = findRelatedGraphContext(graph, {
    text: 'New OpenAI agent systems for developer tools',
    observedAt: '2026-05-20T12:30:00.000Z',
    limit: 5
  });

  assert.ok(context.claims.some((claim) => claim.id === 'claim:1'));
  assert.ok(context.entities.some((entity) => entity.name === 'OpenAI'));
  assert.ok(context.temporalNeighbors.some((node) => node.id === 'claim:1'));
});

test('applied opportunities require speculation label, confidence, risks, and citations', () => {
  const opportunity = {
    id: 'applied-opportunity:1',
    type: 'AppliedOpportunity',
    title: 'Use agent workflow to triage dependency updates',
    speculationLabel: 'Speculative applied opportunity',
    confidence: 0.68,
    riskNotes: ['Needs human review for risky changes.'],
    evidenceIds: ['claim:1'],
    citations: [{ title: 'One', url: 'https://example.com/1', source: 'Example' }]
  };

  const graph = addArtifactToGraph(graphFromRecords([]), opportunity);
  const match = toJsonLd(graph)['@graph'].find((node) => node['@id'] === opportunity.id);

  assert.equal(match.speculationLabel, 'Speculative applied opportunity');
  assert.ok(match.confidence > 0);
  assert.equal(match.citations[0].url, 'https://example.com/1');
});

test('aggregation uses America/Chicago calendar days instead of rolling 24 hours', async () => {
  const root = await tempRoot();
  await appendLedgerRecord(root, 'enriched-docs', {
    id: 'enriched-doc:early',
    status: 'enriched',
    observedAt: '2026-05-20T04:30:00.000Z',
    title: 'Late central previous day'
  });
  await appendLedgerRecord(root, 'enriched-docs', {
    id: 'enriched-doc:today',
    status: 'enriched',
    observedAt: '2026-05-20T06:30:00.000Z',
    title: 'Central today'
  });

  const selected = await aggregateEnrichedDocsForDate({
    root,
    date: '2026-05-20',
    inference: async () => ({
      output: {
        title: 'Daily update',
        summary: 'A daily update.',
        themes: [],
        citations: [],
        omittedRedundancies: []
      },
      provider: 'test',
      model: 'test'
    }),
    now: '2026-05-20T18:00:00.000Z'
  });

  assert.deepEqual(selected.enrichedDocIds, ['enriched-doc:today']);
});

test('generated articles include relation frontmatter, citations, and applied opportunities section', async () => {
  const root = await tempRoot();
  await fs.mkdir(path.join(root, 'data', 'voice'), { recursive: true });
  await fs.writeFile(path.join(root, 'data', 'voice', 'tk-technews.json'), JSON.stringify({
    id: 'tk-technews',
    description: 'Clear, cited, practical technology analysis.',
    rules: ['Cite sources.', 'Label speculation.']
  }, null, 2));
  await appendLedgerRecord(root, 'aggregate-briefs', {
    id: 'aggregate-brief:1',
    status: 'aggregated',
    title: 'Agent update',
    summary: 'Agent workflows are improving.',
    enrichedDocIds: ['enriched-doc:1'],
    citations: [{ title: 'Source', url: 'https://example.com/source', source: 'Example' }],
    appliedOpportunities: [
      {
        title: 'Automate review intake',
        speculationLabel: 'Speculative applied opportunity',
        confidence: 0.7,
        riskNotes: ['Needs oversight.'],
        citations: [{ title: 'Source', url: 'https://example.com/source', source: 'Example' }]
      }
    ]
  });

  const article = await generateArticleFromAggregate({
    root,
    aggregateId: 'aggregate-brief:1',
    voice: 'tk-technews',
    evaluators: [async () => ({
      score: 1,
      verdict: 'pass',
      assertions: [{ name: 'fixture', text: 'Fixture passed.', passed: true, score: 1 }],
      feedback: [],
      requiredFixes: []
    })],
    inference: async () => ({
      output: {
        title: 'Agent Workflows Are Becoming Operational Infrastructure',
        description: 'A cited update on agent workflows.',
        slug: 'agent-workflows-operational-infrastructure',
        tags: ['agents'],
        markdownBody: '## What changed\n\nAgent workflows are becoming practical infrastructure. [Source](https://example.com/source)\n\n## Applied Opportunities\n\nSpeculative applied opportunity: automate review intake with human oversight. [Source](https://example.com/source)',
        citations: [{ title: 'Source', url: 'https://example.com/source', source: 'Example' }]
      },
      provider: 'test',
      model: 'test'
    }),
    now: '2026-05-20T18:00:00.000Z'
  });

  const markdown = await fs.readFile(article.markdownPath, 'utf8');
  assert.match(markdown, /aggregateBriefId: "aggregate-brief:1"/);
  assert.match(markdown, /voice: "tk-technews"/);
  assert.match(markdown, /## Applied Opportunities/);
  assert.match(markdown, /url: "https:\/\/example.com\/source"/);

  const articleRecord = await latestRecordById(root, 'articles', article.id);
  assert.equal(articleRecord.evalStatus, 'passed');
  assert.equal(articleRecord.evalScore, 1);
  assert.equal(articleRecord.evalAttempts, 1);
  assert.equal(articleRecord.evalReport.verdict, 'pass');
});

test('article generation defaults to the hard-science journalist narrator voice', async () => {
  const root = await tempRoot();
  await fs.mkdir(path.join(root, 'data', 'voice'), { recursive: true });
  await fs.writeFile(path.join(root, 'data', 'voice', 'tk-technews-journalist.json'), JSON.stringify({
    id: 'tk-technews-journalist',
    description: 'Tech news journalism with an academic, hard-science analytical spine.',
    tone: 'journalistic-hard-science',
    detailLevel: 'analytical',
    wordChoice: {
      prefer: ['evidence', 'mechanism', 'constraint', 'benchmark'],
      avoid: ['topic brief', 'wiki page']
    },
    rules: ['Lead with the newsworthy technical change.', 'Explain the mechanism and constraints.']
  }, null, 2));
  await appendLedgerRecord(root, 'aggregate-briefs', {
    id: 'aggregate-brief:journalist-default',
    status: 'aggregated',
    title: 'Agent workflow benchmark update',
    summary: 'OpenAI released agent workflows with measurable developer automation constraints.',
    enrichedDocIds: ['enriched-doc:1'],
    citations: [{ title: 'Agents source', url: 'https://example.com/agents', source: 'Example' }],
    appliedOpportunities: []
  });

  let observedVoiceId = null;
  const article = await generateArticleFromAggregate({
    root,
    aggregateId: 'aggregate-brief:journalist-default',
    evaluators: [async () => ({
      score: 1,
      verdict: 'pass',
      assertions: [{ name: 'fixture', text: 'Fixture passed.', passed: true, score: 1 }],
      feedback: [],
      requiredFixes: []
    })],
    inference: async ({ context, prompt }) => {
      observedVoiceId = context.voiceProfile.id;
      assert.match(prompt, /journalistic-hard-science/);
      return {
        output: {
          title: 'Agent Workflows Get a Measurable Engineering Frame',
          description: 'A cited update on agent workflow mechanisms and constraints.',
          slug: 'agent-workflows-engineering-frame',
          tags: ['agents'],
          markdownBody: '## What changed\n\nOpenAI released agent workflows, and the useful signal is the mechanism: repeatable automation with explicit review constraints and measurement points. [Agents source](https://example.com/agents)',
          citations: [{ title: 'Agents source', url: 'https://example.com/agents', source: 'Example' }]
        },
        provider: 'test',
        model: 'test'
      };
    },
    now: '2026-05-20T18:00:00.000Z'
  });

  const markdown = await fs.readFile(article.markdownPath, 'utf8');
  assert.equal(observedVoiceId, 'tk-technews-journalist');
  assert.match(markdown, /voice: "tk-technews-journalist"/);
});

test('briefing refuses source docs that are not parsed', async () => {
  const pending = revisitPendingRecord({
    id: 'source-doc:1',
    canonicalUri: 'https://example.com/pending',
    reasonCode: 'parse_empty_text',
    reasonDetail: 'No text',
    now: '2026-05-20T12:00:00.000Z'
  });

  assert.equal(sourceNeedsRetry(pending), true);
  assert.equal(pending.status, 'revisit_pending');
});

async function tempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'tk-technews-pipeline-'));
}
