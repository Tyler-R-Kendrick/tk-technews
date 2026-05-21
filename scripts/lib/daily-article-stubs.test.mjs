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

test('dedupes repeated daily source content before generating summaries and citations', () => {
  const result = buildDailyArticleStubs({
    date: '2026-05-20',
    ledger: {
      generatedAt: '2026-05-20T18:00:00.000Z',
      items: [
        {
          id: 'tweet-1',
          kind: 'twitterFeeds',
          title: 'GitHub Copilot remote control is generally available',
          summary: 'GitHub Copilot remote control is generally available for CLI and VS Code sessions.',
          url: 'https://x.com/github/status/2057000000000000000',
          sourceName: '@github',
          publishedAt: '2026-05-20T12:00:00.000Z',
          tags: ['github', 'copilot', 'agent']
        },
        {
          id: 'tweet-2',
          kind: 'twitterFeeds',
          title: 'GitHub Copilot remote control is generally available',
          summary: 'GitHub Copilot remote control is generally available for CLI and VS Code sessions.',
          url: 'https://x.com/github/status/2057000000000000000?utm_campaign=social',
          sourceName: '@github',
          publishedAt: '2026-05-20T12:05:00.000Z',
          tags: ['github', 'copilot', 'agent']
        },
        {
          id: 'blog-1',
          title: 'GitHub Copilot remote control reaches general availability',
          summary: 'Remote control for GitHub Copilot CLI and VS Code sessions is now generally available for agent workflows.',
          url: 'https://github.blog/changelog/copilot-remote-control',
          sourceName: 'GitHub Blog',
          publishedAt: '2026-05-20T12:10:00.000Z',
          tags: ['github', 'copilot', 'agent']
        }
      ]
    }
  });

  const page = result.articleStubs[0];
  const renderedText = [
    page.dek,
    ...page.bodySections.flatMap((section) => section.paragraphs),
    ...page.keyTakeaways
  ].join('\n');

  assert.equal(result.sourceItemCount, 2);
  assert.equal(page.sources.length, 2);
  assert.equal(page.sources.filter((source) => source.url.startsWith('https://x.com/github/status/2057000000000000000')).length, 1);
  assert.equal((renderedText.match(/Remote control for GitHub Copilot CLI and VS Code sessions is now generally available/gi) ?? []).length, 1);
});

test('daily article body is exclusively generated bodySections', () => {
  const routeSource = readFileSync(new URL('../../src/pages/daily/[date]/[slug].astro', import.meta.url), 'utf8');

  assert.match(routeSource, /stub\.bodySections/);
  assert.doesNotMatch(routeSource, /stub\.sections/);
  assert.doesNotMatch(routeSource, /Cited Source Notes/);
});

test('each source in article stubs includes a rich citation preview object', () => {
  const result = buildDailyArticleStubs({
    date: '2026-05-20',
    ledger: {
      generatedAt: '2026-05-20T18:00:00.000Z',
      items: [
        {
          id: 'github-1',
          title: 'GitHub Copilot remote control is generally available for agent workflows',
          summary: 'Remote control for GitHub Copilot CLI and VS Code sessions is now generally available for agent coding workflows.',
          url: 'https://github.blog/changelog/copilot-remote-control',
          sourceName: 'GitHub Blog',
          publishedAt: '2026-05-20T12:00:00.000Z',
          tags: ['github', 'copilot', 'agent']
        }
      ]
    }
  });

  const stub = result.articleStubs[0];
  assert.ok(stub, 'expected at least one article stub');
  const source = stub.sources[0];
  assert.ok(source.preview, 'source should include a preview object');
  assert.ok(['tweet', 'video', 'source'].includes(source.preview.kind), `unexpected preview.kind: ${source.preview.kind}`);
  assert.ok(['X post', 'Video', 'Source'].includes(source.preview.label), `unexpected preview.label: ${source.preview.label}`);
  assert.equal(typeof source.preview.href, 'string');
  assert.equal(typeof source.preview.title, 'string');
  assert.equal(typeof source.preview.source, 'string');
  assert.equal(typeof source.preview.snippet, 'string');
  assert.equal(typeof source.preview.host, 'string');
  assert.ok(source.preview.thumbnailUrl === null || typeof source.preview.thumbnailUrl === 'string');
});

test('tweet sources in article stubs get preview.kind === tweet with X post label', () => {
  const result = buildDailyArticleStubs({
    date: '2026-05-20',
    ledger: {
      generatedAt: '2026-05-20T18:00:00.000Z',
      items: [
        {
          id: 'tweet-cf',
          title: 'Claude Managed Agents now allow you to run your agents in self-hosted sandboxes in Cloudflare',
          summary: 'Claude Managed Agents now allow you to run your agents in self-hosted sandboxes in Cloudflare with incredible speed, scale, and full security control.',
          url: 'https://x.com/CloudflareDev/status/2057091308733210902',
          sourceName: '@CloudflareDev',
          publishedAt: '2026-05-20T13:29:21.000Z',
          tags: ['cloudflare', 'agent', 'claude']
        }
      ]
    }
  });

  const stub = result.articleStubs[0];
  assert.ok(stub, 'expected at least one article stub');
  const source = stub.sources.find((s) => s.url.includes('x.com'));
  assert.ok(source, 'expected a tweet source');
  assert.equal(source.preview.kind, 'tweet');
  assert.equal(source.preview.label, 'X post');
  assert.equal(source.preview.host, 'x.com');
});

test('YouTube sources in article stubs get preview.kind === video with thumbnailUrl', () => {
  const result = buildDailyArticleStubs({
    date: '2026-05-20',
    ledger: {
      generatedAt: '2026-05-20T18:00:00.000Z',
      items: [
        {
          id: 'youtube-1',
          title: 'Agentic DevOps with SpecKit: Turn Specs into CI/CD Using GitHub Actions',
          summary: 'This video covers how to use GitHub Actions and agentic coding tools to automate DevOps workflows from specifications.',
          url: 'https://www.youtube.com/watch?v=Zl4tyHVQLkc',
          sourceName: 'Microsoft Reactor',
          publishedAt: '2026-05-20T05:09:46.000Z',
          tags: ['github', 'agents', 'devops', 'workflow']
        }
      ]
    }
  });

  const stub = result.articleStubs[0];
  assert.ok(stub, 'expected at least one article stub');
  const source = stub.sources.find((s) => s.url.includes('youtube.com'));
  assert.ok(source, 'expected a YouTube source');
  assert.equal(source.preview.kind, 'video');
  assert.equal(source.preview.label, 'Video');
  assert.equal(source.preview.thumbnailUrl, 'https://i.ytimg.com/vi/Zl4tyHVQLkc/hqdefault.jpg');
});

test('preview.href matches the source url in article stubs', () => {
  const result = buildDailyArticleStubs({
    date: '2026-05-20',
    ledger: {
      generatedAt: '2026-05-20T18:00:00.000Z',
      items: [
        {
          id: 'vercel-1',
          title: 'Grok Build 0.1 now available on Vercel AI Gateway for agentic coding workflows',
          summary: 'Grok Build 0.1 is a beta coding model trained for agentic coding, now available on Vercel AI Gateway for developer workflows.',
          url: 'https://vercel.com/changelog/grok-build-0-1-now-available-on-vercel-ai-gateway',
          sourceName: 'Vercel News',
          publishedAt: '2026-05-20T07:00:00.000Z',
          tags: ['vercel', 'agents', 'sdk', 'coding']
        }
      ]
    }
  });

  const stub = result.articleStubs[0];
  assert.ok(stub);
  const source = stub.sources[0];
  assert.equal(source.preview.href, source.url);
});
