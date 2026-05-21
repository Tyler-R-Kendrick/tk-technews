import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildGraphCommunities,
  buildTopicResearchPackets,
  buildTopicWikiFromResearchPackets,
  generateWikiFromKnowledgeGraph,
  wikiCacheKey,
  wikiSchema
} from './wiki-generator.mjs';

test('discovers topic pages from graph topics and builds reader-facing research packets', () => {
  const graph = topicGraph();
  const communities = buildGraphCommunities(graph, { seedTypes: ['Topic'], maxCommunities: 10 });
  const packets = buildTopicResearchPackets(communities);

  assert.deepEqual(packets.map((packet) => packet.slug), ['agent-workflows']);
  assert.equal(packets[0].topic, 'Agent Workflows');
  assert.equal(packets[0].citations[0].url, 'https://example.com/agents');
  assert.match(packets[0].evidence[0].excerpt, /OpenAI released agent workflows/);

  const serialized = JSON.stringify(packets);
  assert.doesNotMatch(serialized, /claim:/);
  assert.doesNotMatch(serialized, /topic:/);
  assert.doesNotMatch(serialized, /community:/);
  assert.doesNotMatch(serialized, /node/i);
});

test('builds content-oriented topic stubs without internal process language', () => {
  const packets = buildTopicResearchPackets(buildGraphCommunities(topicGraph(), { seedTypes: ['Topic'] }));
  const wiki = buildTopicWikiFromResearchPackets({
    generatedAt: '2026-05-20T18:00:00.000Z',
    graphHash: 'graph-hash',
    packets,
    mode: 'stub'
  });

  assert.equal(wiki.pages.length, 1);
  assert.equal(wiki.pages[0].status, 'stub');
  assert.equal(wiki.pages[0].title, 'Agent Workflows');
  assert.equal(wiki.pages[0].dek, 'A topic brief for Agent Workflows has not been generated yet.');
  assert.ok(wiki.pages[0].keyDevelopments.length > 0);
  assertNoInternalLanguage(wiki.pages[0]);
});

test('generated topic prompt receives research packets, not graph/community objects', async () => {
  const root = await writeGraph(topicGraph());
  await writeVoiceProfile(root, 'tk-technews-wiki', {
    id: 'tk-technews-wiki',
    description: 'Neutral, compact, source-grounded wiki page narration for technical readers.',
    tone: 'reference',
    detailLevel: 'concise',
    wordChoice: {
      prefer: ['definition', 'source', 'evidence', 'context', 'development'],
      avoid: ['trial', 'verdict', 'phase transition']
    },
    rules: ['Use neutral reference prose.', 'Keep sections concise and scannable.']
  });

  const wiki = await generateWikiFromKnowledgeGraph({
    root,
    now: '2026-05-20T18:00:00.000Z',
    useInference: true,
    evaluators: [async () => ({
      score: 1,
      verdict: 'pass',
      assertions: [{ name: 'fixture', text: 'Fixture passed.', passed: true, score: 1 }],
      feedback: [],
      requiredFixes: []
    })],
    inference: async ({ schema, context, prompt }) => {
      assert.equal(context.researchPackets.length, 1);
      assert.equal(context.voiceProfile.id, 'tk-technews-wiki');
      assert.equal(Object.hasOwn(context, 'graphHash'), false);
      assert.match(prompt, /Research packets:/);
      assert.match(prompt, /tk-technews-wiki/);
      assert.match(prompt, /OpenAI released agent workflows/);
      assert.doesNotMatch(prompt, /claim:/);
      assert.doesNotMatch(prompt, /topic:/);
      assert.doesNotMatch(prompt, /community:/);
      assert.doesNotMatch(prompt, /knowledge graph/i);
      return {
        output: schema.parse({
          generatedAt: '2026-05-20T18:00:00.000Z',
          graphHash: 'model-output-hash-is-ignored',
          landing: {
            title: 'AI Topic Wiki',
            description: 'Reader-facing topic explainers from the latest source corpus.',
            overview: 'Explore current AI topics through concise explainers and cited source evidence.',
            featuredPageSlugs: ['agent-workflows']
          },
          pages: [{
            slug: 'agent-workflows',
            title: 'Agent Workflows',
            dek: 'Agent workflows are shifting AI from single prompts toward coordinated developer processes.',
            summary: 'Agent workflows are becoming a practical layer for developers who need repeatable review, coding, and automation loops backed by current AI systems.',
            status: 'generated',
            sections: [{
              title: 'What changed',
              body: 'OpenAI released agent workflows for developers, pointing toward more structured AI-assisted software processes.',
              citationUrls: ['https://example.com/agents']
            }],
            keyDevelopments: [{
              text: 'OpenAI released agent workflows for developers.',
              citationUrls: ['https://example.com/agents']
            }],
            whyItMatters: 'The shift matters because developer teams can turn AI assistance into repeatable workflows instead of isolated chat sessions.',
            openQuestions: [{
              question: 'How much review work can these workflows safely automate?',
              context: 'The cited source establishes the workflow direction, but operational reliability still needs evidence.',
              citationUrls: ['https://example.com/agents']
            }],
            relatedTopics: [],
            citations: [{ title: 'Agents source', url: 'https://example.com/agents', source: 'Example' }],
            metadata: {
              topicId: 'topic:agents',
              sourceDocIds: ['source-doc:agents']
            }
          }]
        }),
        provider: 'test',
        model: 'test'
      };
    }
  });

  assert.equal(wiki.pages[0].slug, 'agent-workflows');
  assert.equal(wiki.cache.key, wikiCacheKey(wiki.graphHash));
  assert.equal(wiki.cache.evalStatus, 'passed');
  assert.equal(wiki.cache.evalScore, 1);
  assert.equal(wiki.cache.evalAttempts, 1);
  assertNoInternalLanguage(wiki.pages[0]);
});

test('schema rejects reader-facing internal identifiers and process language', () => {
  const invalid = {
    generatedAt: '2026-05-20T18:00:00.000Z',
    graphHash: 'hash',
    landing: {
      title: 'Wiki',
      description: 'Generated.',
      overview: 'Overview.',
      featuredPageSlugs: ['bad']
    },
    pages: [{
      slug: 'bad',
      title: 'Bad',
      dek: 'This node topic:ai is generated from a knowledge graph community.',
      summary: 'The page centers on claim:abc.',
      status: 'generated',
      sections: [],
      keyDevelopments: [],
      whyItMatters: 'It matters because of a graph traversal.',
      openQuestions: [],
      relatedTopics: [],
      citations: [{ title: 'Source', url: 'https://example.com', source: 'Example' }],
      metadata: { topicId: 'topic:bad', sourceDocIds: [] }
    }]
  };

  assert.equal(wikiSchema.safeParse(invalid).success, false);
});

test('omitted generated pages remain reader-facing stubs with natural related topic links', async () => {
  const root = await writeGraph({
    '@context': {},
    '@graph': [
      ...topicGraph()['@graph'],
      { '@id': 'topic:models', '@type': 'Topic', name: 'Model Releases', citations: [{ title: 'Models source', url: 'https://example.com/models', source: 'Example' }] },
      { '@id': 'claim:models', '@type': 'Claim', text: 'A model release shipped for developers.', citations: [{ title: 'Models source', url: 'https://example.com/models', source: 'Example' }] },
      { '@id': 'edge:models', '@type': 'supportsClaim', from: 'topic:models', to: 'claim:models' }
    ]
  });

  const wiki = await generateWikiFromKnowledgeGraph({
    root,
    now: '2026-05-20T18:00:00.000Z',
    useInference: true,
    inference: async ({ schema }) => ({
      output: schema.parse({
        generatedAt: '2026-05-20T18:00:00.000Z',
        graphHash: 'model-output-hash-is-ignored',
        landing: {
          title: 'AI Topic Wiki',
          description: 'Topic explainers.',
          overview: 'Explore AI topics.',
          featuredPageSlugs: ['agent-workflows']
        },
        pages: []
      }),
      provider: 'test',
      model: 'test'
    })
  });

  assert.ok(wiki.pages.some((page) => page.slug === 'agent-workflows' && page.status === 'stub'));
  assert.ok(wiki.pages.some((page) => page.slug === 'model-releases' && page.status === 'stub'));
  assert.ok(wiki.pages.every((page) => page.relatedTopics.every((topic) => !/claim:|topic:|node|graph|community/i.test(topic.reason))));
});

test('skips source-family topic nodes when building navigable wiki topics', () => {
  const graph = {
    '@context': {},
    '@graph': [
      { '@id': 'topic:googlenews', '@type': 'Topic', name: 'googlenews', citations: [{ title: 'News', url: 'https://example.com/news', source: 'Example' }] },
      { '@id': 'topic:openai', '@type': 'Topic', name: 'openai', citations: [{ title: 'OpenAI', url: 'https://example.com/openai', source: 'Example' }] },
      { '@id': 'claim:openai', '@type': 'Claim', text: 'OpenAI shipped an update.', citations: [{ title: 'OpenAI', url: 'https://example.com/openai', source: 'Example' }] },
      { '@id': 'edge:1', '@type': 'supportsClaim', from: 'topic:openai', to: 'claim:openai' }
    ]
  };

  const communities = buildGraphCommunities(graph, { seedTypes: ['Topic'], maxCommunities: 10 });

  assert.deepEqual(communities.map((community) => community.label), ['openai']);
});

async function writeGraph(graph) {
  const root = await tempRoot();
  await fs.mkdir(path.join(root, 'data', 'graph'), { recursive: true });
  await fs.writeFile(path.join(root, 'data', 'graph', 'kg.jsonld'), JSON.stringify(graph, null, 2));
  return root;
}

async function writeVoiceProfile(root, voice, profile) {
  await fs.mkdir(path.join(root, 'data', 'voice'), { recursive: true });
  await fs.writeFile(path.join(root, 'data', 'voice', `${voice}.json`), JSON.stringify(profile, null, 2));
}

function topicGraph() {
  return {
    '@context': {},
    '@graph': [
      { '@id': 'topic:agents', '@type': 'Topic', name: 'Agent Workflows', citations: [{ title: 'Agents source', url: 'https://example.com/agents', source: 'Example' }] },
      { '@id': 'entity:openai', '@type': 'Entity', name: 'OpenAI', citations: [{ title: 'Agents source', url: 'https://example.com/agents', source: 'Example' }] },
      { '@id': 'claim:agents', '@type': 'Claim', text: 'OpenAI released agent workflows for developers.', citations: [{ title: 'Agents source', url: 'https://example.com/agents', source: 'Example' }] },
      { '@id': 'source-doc:agents', '@type': 'SourceDocument', title: 'Agents source', canonicalUri: 'https://example.com/agents', sourceName: 'Example', publishedAt: '2026-05-20T12:00:00.000Z', textSpans: [] },
      { '@id': 'edge:1', '@type': 'mentions', from: 'topic:agents', to: 'entity:openai' },
      { '@id': 'edge:2', '@type': 'supportsClaim', from: 'topic:agents', to: 'claim:agents' },
      { '@id': 'edge:3', '@type': 'derivedFrom', from: 'claim:agents', to: 'source-doc:agents' }
    ]
  };
}

function assertNoInternalLanguage(page) {
  const rendered = JSON.stringify({
    title: page.title,
    dek: page.dek,
    summary: page.summary,
    sections: page.sections,
    keyDevelopments: page.keyDevelopments,
    whyItMatters: page.whyItMatters,
    openQuestions: page.openQuestions,
    relatedTopics: page.relatedTopics
  });
  assert.doesNotMatch(rendered, /claim:/i);
  assert.doesNotMatch(rendered, /topic:/i);
  assert.doesNotMatch(rendered, /community/i);
  assert.doesNotMatch(rendered, /knowledge graph/i);
  assert.doesNotMatch(rendered, /\bnode\b/i);
  assert.doesNotMatch(rendered, /traversal/i);
}

async function tempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'tk-technews-wiki-'));
}
