import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildDailyArticleStubs } from './daily-article-stubs.mjs';

test('builds deduped daily article stubs from monitored source items', () => {
  const result = buildDailyArticleStubs({
    date: '2026-05-20',
    ledger: {
      generatedAt: '2026-05-20T18:00:00.000Z',
      window: { startDate: '2026-05-20', endDate: '2026-05-20' },
      items: [
        {
          id: 'openai-1',
          title: 'OpenAI releases new agent workflows for developers',
          summary: 'OpenAI announced agent workflow updates for developer automation.',
          url: 'https://example.com/openai-agents',
          sourceName: 'OpenAI',
          publishedAt: '2026-05-20T12:00:00.000Z',
          tags: ['openai', 'agents', 'dev']
        },
        {
          id: 'openai-2',
          title: 'OpenAI agent workflows arrive for software teams',
          summary: 'A related report covers OpenAI agent workflows for coding teams.',
          url: 'https://example.com/openai-agents-2',
          sourceName: 'Google News',
          publishedAt: '2026-05-20T13:00:00.000Z',
          tags: ['openai', 'agents', 'ai']
        },
        {
          id: 'anthropic-1',
          title: 'Anthropic rolls out Claude updates for enterprise users',
          summary: 'Anthropic announced Claude features for business customers.',
          url: 'https://example.com/claude-enterprise',
          sourceName: 'Anthropic',
          publishedAt: '2026-05-20T11:00:00.000Z',
          tags: ['anthropic', 'claude']
        },
        {
          id: 'social-1',
          title: 'NYC fireside chat during tech week',
          summary: 'A generic social event post without technical substance.',
          url: 'https://example.com/event',
          sourceName: 'X',
          publishedAt: '2026-05-20T15:00:00.000Z',
          tags: ['twitterfeeds']
        },
        {
          id: 'old-1',
          title: 'Old AI model news',
          summary: 'Outside the requested day.',
          url: 'https://example.com/old',
          sourceName: 'Old Source',
          publishedAt: '2026-05-19T11:00:00.000Z',
          tags: ['model']
        }
      ]
    }
  });

  assert.equal(result.date, '2026-05-20');
  assert.equal(result.articleStubs.length, 2);
  assert.deepEqual(result.articleStubs.map((stub) => stub.sourceCount), [2, 1]);
  assert.equal(result.articleStubs[0].status, 'stub');
  assert.match(result.articleStubs[0].title, /OpenAI agent workflows/i);
  assert.equal(result.articleStubs[0].sources.length, 2);
  assert.ok(result.articleStubs[0].href.startsWith('/daily/2026-05-20/'));
  assert.ok(result.articleStubs.every((stub) => !stub.sources.some((source) => source.url === 'https://example.com/old')));
  assert.ok(result.articleStubs.every((stub) => !stub.sources.some((source) => source.url === 'https://example.com/event')));
});

test('generates reader-facing article content from transcript-enriched YouTube source knowledge', () => {
  const result = buildDailyArticleStubs({
    date: '2026-05-20',
    ledger: {
      generatedAt: '2026-05-20T18:00:00.000Z',
      items: [{
        id: 'youtube-memory',
        kind: 'youtube',
        title: 'Phase Transitions in Agent Memory: Recurrent Memory',
        summary: 'The video explains recurrent memory for long-running LLM agents, where a phase transition trigger consolidates subconscious, semantic, and episodic memory so agents can retain useful state over multi-hour tasks.',
        url: 'https://www.youtube.com/watch?v=lPKOJxfsGG4',
        sourceName: 'Discover AI',
        publishedAt: '2026-05-20T13:15:14.000Z',
        tags: ['youtube', 'academics', 'agent memory'],
        transcript: {
          status: 'ok',
          videoId: 'lPKOJxfsGG4',
          text: 'The paper introduces recurrence based memory for long-running LLM agents. The presenter says agents working for hours or days need memory because without it they start from a blank sheet. The method waits for recurring patterns to reach a phase transition threshold before consolidating them. Those patterns become semantic memory and episodic memory instead of being pushed immediately into a prompt. The presenter also flags limits: vector embeddings struggle with hard negations, and static thresholds can be brittle.'
        }
      }]
    }
  });

  const page = result.articleStubs[0];
  assert.ok(page.bodySections.length >= 2);
  assert.ok(page.keyTakeaways.length > 0);

  const rendered = JSON.stringify({
    dek: page.dek,
    bodySections: page.bodySections,
    keyTakeaways: page.keyTakeaways,
    sources: page.sources
  });

  assert.match(rendered, /recurrent memory/i);
  assert.match(rendered, /long-running LLM agents/i);
  assert.match(rendered, /semantic, and episodic memory/i);
  assert.doesNotMatch(rendered, /What it covers|What the video covers|Why it matters|Transcript signal|Draft Direction|Topic Summary|Open Questions|Applied Opportunities/i);
  assert.doesNotMatch(rendered, /stub consolidates/i);
  assert.doesNotMatch(rendered, /draftable story angle/i);
  assert.doesNotMatch(rendered, /monitored source/i);
  assert.doesNotMatch(rendered, /pipeline|knowledge graph|internal process/i);
});

test('daily article body is exclusively generated bodySections', () => {
  const routeSource = readFileSync(new URL('../../src/pages/daily/[date]/[slug].astro', import.meta.url), 'utf8');

  assert.match(routeSource, /stub\.bodySections/);
  assert.doesNotMatch(routeSource, /stub\.sections/);
  assert.doesNotMatch(routeSource, /Cited Source Notes/);
});
