import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildDailyArticleStubs,
  buildDailyArticleStubsWithGenerationLoop,
  evaluateDailyArticleContent
} from './daily-article-stubs.mjs';

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

test('clusters related social and article URLs using canonical URL keys', () => {
  const result = buildDailyArticleStubs({
    date: '2026-05-20',
    ledger: {
      generatedAt: '2026-05-20T18:00:00.000Z',
      items: [
        {
          id: 'tweet-quote',
          kind: 'twitterFeeds',
          title: 'RT elvis: Can coding agents do research?',
          summary: 'RT elvis Can coding agents do research? Read more: https://www.intology.ai/blog/nanogpt-bench?utm_source=x',
          url: 'https://x.com/omarsar0/status/2057067617156800573?utm_campaign=social',
          sourceName: '@omarsar0',
          publishedAt: '2026-05-20T12:00:00.000Z',
          tags: ['ai', 'agents', 'research']
        },
        {
          id: 'article',
          title: 'Can coding agents do research?',
          summary: 'NanoGPT-Bench measures whether coding agents can recover AI research progress.',
          url: 'https://www.intology.ai/blog/nanogpt-bench',
          sourceName: 'Intology',
          publishedAt: '2026-05-20T12:05:00.000Z',
          tags: ['ai', 'agents', 'research']
        }
      ]
    }
  });

  assert.equal(result.articleStubs.length, 1);
  assert.equal(result.articleStubs[0].sources.length, 2);
  assert.ok(result.articleStubs[0].sources.some((source) => source.url.includes('x.com/omarsar0/status/2057067617156800573')));
  assert.ok(result.articleStubs[0].sources.some((source) => source.url === 'https://www.intology.ai/blog/nanogpt-bench'));
});

test('daily article body is exclusively generated bodySections', () => {
  const routeSource = readFileSync(new URL('../../src/pages/daily/[date]/[slug].astro', import.meta.url), 'utf8');

  assert.match(routeSource, /stub\.bodySections/);
  assert.doesNotMatch(routeSource, /stub\.sections/);
  assert.doesNotMatch(routeSource, /Cited Source Notes/);
});

test('daily article route renders generated inline markdown citations as html', () => {
  const routeSource = readFileSync(new URL('../../src/pages/daily/[date]/[slug].astro', import.meta.url), 'utf8');

  assert.match(routeSource, /renderInlineMarkdown/);
  assert.match(routeSource, /set:html\s*=\s*\{\s*renderInlineMarkdown\(\s*paragraph\s*\)\s*\}/);
  assert.match(routeSource, /set:html\s*=\s*\{\s*renderInlineMarkdown\(\s*takeaway\s*\)\s*\}/);
});

test('daily article citation rail renders rich quote and retweet metadata', () => {
  const routeSource = readFileSync(new URL('../../src/pages/daily/[date]/[slug].astro', import.meta.url), 'utf8');

  assert.match(routeSource, /rich-social-context/);
  assert.match(routeSource, /Reposted from/);
  assert.match(routeSource, /rich-quoted-source/);
  assert.match(routeSource, /Quoted source/);
});

test('daily generation loop rejects title-echo pages without actual article content', async () => {
  const stub = {
    title: 'OpenAI Cheap Could Derail Update',
    slug: '2026-05-20-openai-cheap-could-derail-update',
    dek: 'Google Cloud course builds AI agents for media blockchain.news',
    tags: ['OpenAI', 'Anthropic', 'Google'],
    sources: [
      {
        title: "Cheap AI could derail OpenAI and Anthropic's IPOs - CNBC",
        url: 'https://news.google.com/rss/articles/openai-cheap',
        sourceName: '"anthropic" - Google News',
        summary: "Cheap AI could derail OpenAI and Anthropic's IPOs CNBC",
        preview: {
          title: "Cheap AI could derail OpenAI and Anthropic's IPOs - CNBC",
          snippet: "Cheap AI could derail OpenAI and Anthropic's IPOs CNBC"
        }
      },
      {
        title: 'Google Cloud course builds AI agents for media - blockchain.news',
        url: 'https://news.google.com/rss/articles/google-cloud-course',
        sourceName: '"andrewyng" - Google News',
        summary: 'Google Cloud course builds AI agents for media blockchain.news',
        preview: {
          title: 'Google Cloud course builds AI agents for media - blockchain.news',
          snippet: 'Google Cloud course builds AI agents for media blockchain.news'
        }
      }
    ]
  };

  const report = await evaluateDailyArticleContent({
    output: {
      dek: 'Google Cloud course builds AI agents for media blockchain.news',
      bodySections: [{
        heading: 'Openai Cheap Could Derail Google Changes The Practical Tradeoff',
        paragraphs: ["Openai Cheap Could Derail Google: Cheap AI could derail OpenAI and Anthropic's IPOs CNBC"],
        citations: ['https://news.google.com/rss/articles/openai-cheap']
      }],
      keyTakeaways: ['Cheap AI could derail OpenAI and Anthropic IPOs CNBC']
    },
    context: {
      stub,
      allowedCitations: stub.sources.map((source) => ({ title: source.title, url: source.url, source: source.sourceName })),
      relevanceText: stub.sources.map((source) => `${source.title} ${source.summary}`).join(' ')
    }
  });

  assert.equal(report.verdict, 'fail');
  assert.ok(report.requiredFixes.some((fix) => /real body content|at least 120/i.test(fix)));
  assert.ok(report.requiredFixes.some((fix) => /repeats headline|source metadata/i.test(fix)));
  assert.ok(report.requiredFixes.some((fix) => /generated metadata|template/i.test(fix)));
});

test('daily article evaluator rejects source-instruction explainer prose without usable source grounding', async () => {
  const stub = {
    title: 'Self Evolving AI Skills w/ GPT-5.5 (SkillOpt)',
    dek: 'No usable text was extracted from this source.',
    tags: ['self', 'evolving', 'skills'],
    sources: [
      {
        title: 'Self Evolving AI Skills w/ GPT-5.5 (SkillOpt)',
        url: 'https://www.youtube.com/watch?v=self-evolving-skills',
        sourceName: 'Discover AI',
        summary: 'No usable text was extracted from this source.',
        preview: {
          title: 'Self Evolving AI Skills w/ GPT-5.5 (SkillOpt)',
          source: 'Discover AI',
          snippet: 'No usable text was extracted from this source.'
        }
      }
    ]
  };

  const report = await evaluateDailyArticleContent({
    output: {
      dek: 'Self and Evolving signal is best read as a measurement problem: 1 source point to a concrete technical shift, but the evidence still needs careful separation from market or platform noise.',
      bodySections: [
        {
          heading: 'Self Has A Measurable Technical Core',
          paragraphs: [
            'Self and Evolving signal matters because the source set is not just naming a product or company; it is pointing at a mechanism developers or AI teams may need to evaluate. The strongest evidence is a cited source signal connected to Self, Evolving, Skills, which gives the story a technical object rather than a headline-only signal. That makes the useful question less "who announced what" and more "what architecture, workflow, or measurement changes if this source is accurate."'
          ],
          citations: ['https://www.youtube.com/watch?v=self-evolving-skills']
        },
        {
          heading: 'The Constraint Is What The Sources Can Actually Support',
          paragraphs: [
            'The constraint is that the daily feed mixes direct technical sources with syndicated summaries, so the article should preserve uncertainty instead of inflating sparse metadata into a verdict. Only one source is available, so the evidence supports a narrower technical read rather than a broad market claim. For a hard-science read, that means treating each claim as a measurement input: useful for direction, limited for causal certainty.'
          ],
          citations: ['https://www.youtube.com/watch?v=self-evolving-skills']
        }
      ],
      keyTakeaways: [
        'Self and Evolving signal should be read through its cited evidence first; the feed gives a technical signal, not a complete causal proof.',
        'The relevant mechanism is the workflow, model, architecture, or measurement implied by the sources, while weak syndicated metadata should stay bounded.'
      ]
    },
    context: {
      stub,
      allowedCitations: stub.sources.map((source) => ({ title: source.title, url: source.url, source: source.sourceName })),
      relevanceText: stub.sources.map((source) => `${source.title} ${source.summary}`).join(' ')
    }
  });

  assert.equal(report.verdict, 'fail');
  assert.ok(report.requiredFixes.some((fix) => /instruction|source metadata|usable source|grounded/i.test(fix)));
});

test('daily generation loop does not pass generic articles when cited sources have no extracted text', async () => {
  const result = await buildDailyArticleStubsWithGenerationLoop({
    date: '2026-05-20',
    ledger: {
      generatedAt: '2026-05-20T18:00:00.000Z',
      items: [
        {
          id: 'self-evolving-skills',
          title: 'Self Evolving AI Skills w/ GPT-5.5 (SkillOpt)',
          summary: 'No usable text was extracted from this source.',
          url: 'https://www.youtube.com/watch?v=self-evolving-skills',
          sourceName: 'Discover AI',
          publishedAt: '2026-05-20T13:15:14.000Z',
          tags: ['youtube', 'self evolving', 'skillopt']
        }
      ]
    },
    maxStubs: 1
  });
  const stub = result.articleStubs[0];
  const generatedText = [
    stub.dek,
    ...stub.bodySections.flatMap((section) => [section.heading, ...section.paragraphs]),
    ...stub.keyTakeaways
  ].join('\n');

  assert.equal(stub.evalStatus, 'best_effort');
  assert.equal(stub.status, 'best_effort');
  assert.doesNotMatch(generatedText, /measurement problem|source set|daily feed|cited source signal|if this source is accurate/i);
});

test('daily article evaluator treats headline-only snippets as unusable source evidence', async () => {
  const stub = {
    title: 'OpenAI Who Will Win Update',
    dek: 'Who will win the AI IPO race between SpaceX, Anthropic and OpenAI?',
    tags: ['openai', 'anthropic'],
    sources: [
      {
        title: 'Who will win the AI IPO race between SpaceX, Anthropic and OpenAI? - The Week',
        url: 'https://news.google.com/rss/articles/openai-ipo-race',
        sourceName: '"anthropic" - Google News',
        summary: 'Who will win the AI IPO race between SpaceX, Anthropic and OpenAI?',
        preview: {
          title: 'Who will win the AI IPO race between SpaceX, Anthropic and OpenAI? - The Week',
          source: '"anthropic" - Google News',
          snippet: 'Who will win the AI IPO race between SpaceX, Anthropic and OpenAI? The Week'
        }
      }
    ]
  };

  const report = await evaluateDailyArticleContent({
    output: {
      dek: 'OpenAI and Anthropic IPO speculation is a technical market signal that needs careful evidence.',
      bodySections: [
        {
          heading: 'The Market Claim Needs Evidence',
          paragraphs: [
            'OpenAI and Anthropic are presented as part of a possible AI IPO race, but the supplied citation only repeats the headline. That is not enough evidence to explain revenue mechanics, model economics, infrastructure constraints, or investor demand with a grounded technical analysis.'
          ],
          citations: ['https://news.google.com/rss/articles/openai-ipo-race']
        },
        {
          heading: 'The Engineering Consequence Is Unclear',
          paragraphs: [
            'Without extracted article text, the article cannot connect the IPO claim to concrete architecture, benchmark, cost, or deployment trade-offs. A grounded explainer needs details from the cited source before it can separate market narrative from measurable technical constraints.'
          ],
          citations: ['https://news.google.com/rss/articles/openai-ipo-race']
        }
      ],
      keyTakeaways: [
        'Headline-only Google News snippets are not enough evidence for a grounded daily explainer.',
        'The generator should wait for source text before drawing technical conclusions from an IPO headline.'
      ]
    },
    context: {
      stub,
      allowedCitations: stub.sources.map((source) => ({ title: source.title, url: source.url, source: source.sourceName })),
      relevanceText: stub.sources.map((source) => `${source.title} ${source.summary}`).join(' ')
    }
  });

  assert.equal(report.verdict, 'fail');
  assert.ok(report.requiredFixes.some((fix) => /usable extracted source text|usable source|grounded/i.test(fix)));
});

test('daily article evaluator rejects generic scaffold prose in generated articles', async () => {
  const stub = {
    title: 'Running Local AI on AMD',
    tags: ['local ai', 'amd'],
    sources: [
      {
        title: 'Running Local AI on AMD',
        url: 'https://www.youtube.com/watch?v=amd-local',
        sourceName: 'Sam Witteveen',
        summary: 'Open weight models are closing the gap with frontier systems while agentic workloads increase token costs, making local AI hardware attractive for privacy, control, and predictable inference budgets.',
        preview: {
          title: 'Running Local AI on AMD',
          source: 'Sam Witteveen',
          snippet: 'Open weight models are closing the gap with frontier systems while agentic workloads increase token costs, making local AI hardware attractive for privacy, control, and predictable inference budgets.'
        }
      }
    ]
  };

  const report = await evaluateDailyArticleContent({
    output: {
      dek: 'Local AI on AMD is a useful source because it changes what builders measure.',
      bodySections: [
        {
          heading: 'Local AI Explains The Technical Change',
          paragraphs: [
            'Open weight models are closing the gap with frontier systems while agentic workloads increase token costs. The mechanism to watch is concrete: Local AI changes what builders measure, where workflow constraints appear, and which operational trade-offs need evidence before teams act on the claim. That gives the article a checkable claim instead of a title-level summary.'
          ],
          citations: ['https://www.youtube.com/watch?v=amd-local']
        },
        {
          heading: 'Token Costs Define The Tradeoff',
          paragraphs: [
            'The source ties local hardware to privacy, control, and predictable inference budgets. The Local AI angle is the technical lens for interpreting that detail, and readers can use it to decide whether this is more than a headline.'
          ],
          citations: ['https://www.youtube.com/watch?v=amd-local']
        }
      ],
      keyTakeaways: [
        'The article must explain the source rather than reuse generic generator scaffold.',
        'Grounded prose should name the AMD/local-AI trade-off directly.'
      ]
    },
    context: {
      stub,
      allowedCitations: stub.sources.map((source) => ({ title: source.title, url: source.url, source: source.sourceName })),
      relevanceText: stub.sources.map((source) => `${source.title} ${source.summary}`).join(' ')
    }
  });

  assert.equal(report.verdict, 'fail');
  assert.ok(report.requiredFixes.some((fix) => /instructions|source metadata|uncertainty policy|generation|cited sources/i.test(fix)));
});

test('publish-only daily generation drops failed title-only articles while keeping grounded articles', async () => {
  const result = await buildDailyArticleStubsWithGenerationLoop({
    date: '2026-05-20',
    ledger: {
      generatedAt: '2026-05-20T18:00:00.000Z',
      items: [
        {
          id: 'openai-ipo-1',
          title: 'Who will win the AI IPO race between SpaceX, Anthropic and OpenAI? - The Week',
          summary: 'Who will win the AI IPO race between SpaceX, Anthropic and OpenAI? The Week',
          url: 'https://news.google.com/rss/articles/openai-ipo-race',
          sourceName: '"anthropic" - Google News',
          publishedAt: '2026-05-20T17:00:00.000Z',
          tags: ['openai', 'anthropic', 'ai']
        },
        {
          id: 'openai-ipo-2',
          title: "OpenAI's Altman says AI unlikely to lead to 'jobs apocalypse' - Reuters",
          summary: "OpenAI's Altman says AI unlikely to lead to 'jobs apocalypse' Reuters",
          url: 'https://news.google.com/rss/articles/openai-jobs',
          sourceName: '"openai" - Google News',
          publishedAt: '2026-05-20T17:01:00.000Z',
          tags: ['openai', 'ai']
        },
        {
          id: 'cursor-model',
          title: 'Cursor just beat EVERYONE.',
          summary: 'Cursor released Composer 2.5, a coding model focused on lower cost per task and higher CursorBench performance. The video compares it with frontier models and argues that workhorse coding models can become the default for everyday agentic programming.',
          url: 'https://www.youtube.com/watch?v=cursor-model',
          sourceName: 'Matthew Berman',
          publishedAt: '2026-05-20T16:40:27.000Z',
          tags: ['youtube', 'cursor', 'coding'],
          transcript: {
            status: 'ok',
            videoId: 'cursor-model',
            text: 'Cursor released Composer 2.5, the next iteration of its homegrown coding model. The presenter says the important part is price-to-performance on CursorBench: Composer 2.5 is framed as a workhorse coding model for everyday agentic programming, not a general frontier model. The video says lower cost per task matters because coding agents burn tokens during long-running tool calls and sustained work.'
          }
        }
      ]
    },
    maxStubs: 2,
    publishOnlyPassed: true,
    requireUsableSourceEvidence: true
  });

  assert.equal(result.articleStubs.length, 1);
  assert.equal(result.articleStubs[0].status, 'generated');
  assert.match(result.articleStubs[0].title, /Cursor/i);
  assert.doesNotMatch(JSON.stringify(result.articleStubs), /Who will win the AI IPO race/i);
});

test('daily generation loop produces substantive journalist content and eval metadata for every page', async () => {
  const result = await buildDailyArticleStubsWithGenerationLoop({
    date: '2026-05-20',
    ledger: {
      generatedAt: '2026-05-20T18:00:00.000Z',
      items: [
        {
          id: 'openai-cheap',
          title: "Cheap AI could derail OpenAI and Anthropic's IPOs - CNBC",
          summary: 'CNBC reported that cheaper inference and open-source models could pressure the high revenue multiples assumed for OpenAI and Anthropic IPOs, because enterprise buyers may route more workloads to lower-cost systems.',
          url: 'https://news.google.com/rss/articles/openai-cheap',
          sourceName: '"anthropic" - Google News',
          publishedAt: '2026-05-20T12:00:00.000Z',
          tags: ['openai', 'anthropic', 'google', 'agent']
        },
        {
          id: 'google-course',
          title: 'Google Cloud course builds AI agents for media - blockchain.news',
          summary: 'Google Cloud introduced a course showing media teams how to build AI agents that ingest assets, orchestrate editorial workflows, and automate production tasks with Gemini and cloud services.',
          url: 'https://news.google.com/rss/articles/google-cloud-course',
          sourceName: '"andrewyng" - Google News',
          publishedAt: '2026-05-20T12:05:00.000Z',
          tags: ['google', 'agent', 'workflow']
        }
      ]
    },
    maxStubs: 1
  });

  const stub = result.articleStubs[0];
  const bodyText = [
    stub.dek,
    ...stub.bodySections.flatMap((section) => [section.heading, ...section.paragraphs]),
    ...stub.keyTakeaways
  ].join('\n');

  assert.equal(stub.evalStatus, 'passed');
  assert.equal(stub.provider, 'deterministic-daily-journalist');
  assert.ok(stub.evalScore >= 0.86);
  assert.ok(stub.bodySections.length >= 2);
  assert.ok(bodyText.split(/\s+/).length >= 150);
  assert.doesNotMatch(bodyText, /Changes The Practical Tradeoff/);
  assert.doesNotMatch(bodyText, /^Openai Cheap Could Derail Google:/m);
  assert.doesNotMatch(bodyText, /Google Cloud course builds AI agents for media blockchain\.news/);
  assert.match(bodyText, /evidence|mechanism|constraint|measurement|trade-off|architecture/i);
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

test('article stub sources omit raw transcript payloads from generated artifacts', () => {
  const result = buildDailyArticleStubs({
    date: '2026-05-20',
    ledger: {
      generatedAt: '2026-05-20T18:00:00.000Z',
      items: [
        {
          id: 'youtube-memory',
          kind: 'youtube',
          title: 'Phase Transitions in Agent Memory: Recurrent Memory',
          summary: 'The video analyzes recurrent memory for long-running LLM agents and describes phase-transition style consolidation thresholds.',
          transcriptSummary: 'Recurrent memory stores incoming interactions in lightweight embedding space, then invokes heavier consolidation only when related interactions reach a density threshold.',
          transcript: {
            isGenerated: true,
            status: 'ok',
            text: 'raw transcript '.repeat(300)
          },
          url: 'https://www.youtube.com/watch?v=ViMRzszqpWM',
          sourceName: 'AI Explained',
          publishedAt: '2026-05-20T05:09:46.000Z',
          tags: ['agents', 'memory', 'research']
        }
      ]
    }
  });

  const source = result.articleStubs[0]?.sources[0];

  assert.ok(source, 'expected a generated source card');
  assert.equal(source.preview.kind, 'video');
  assert.equal(source.preview.thumbnailUrl, 'https://i.ytimg.com/vi/ViMRzszqpWM/hqdefault.jpg');
  assert.equal(Object.hasOwn(source, 'transcript'), false);
  assert.doesNotMatch(JSON.stringify(result), /raw transcript raw transcript/);
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

test('retweets and quoted posts stay out of generated prose and remain rich source previews', () => {
  const result = buildDailyArticleStubs({
    date: '2026-05-20',
    ledger: {
      generatedAt: '2026-05-20T18:00:00.000Z',
      items: [
        {
          id: 'nanogpt-retweet',
          kind: 'twitterFeeds',
          title: 'RT elvis: Very interesting results from this NanoGPT-Bench eval. There is so much talk about self-improving agents.',
          summary: 'RT elvisVery interesting results from this NanoGPT-Bench eval.There is so much talk about self-improving agents.But can coding agents do real AI R&D?@IntologyAI reports that Codex, Claude Code, and Autoresearch recover only 9.3% of human progress.Read more here: https://www.intology.ai/blog/nanogpt-benchIntology: Can coding agents do research?We release NanoGPT-Bench, an internal eval we’ve used to test agents on an AI R&D problem.',
          url: 'https://x.com/omarsar0/status/2057067617156800573',
          sourceName: '@omarsar0',
          publishedAt: '2026-05-20T12:00:00.000Z',
          tags: ['ai', 'agents', 'research']
        },
        {
          id: 'nanogpt-article',
          title: 'Can coding agents do research?',
          summary: 'Intology released NanoGPT-Bench to measure whether coding agents can recover human AI research progress on a controlled R&D task.',
          url: 'https://www.intology.ai/blog/nanogpt-bench',
          sourceName: 'Intology',
          publishedAt: '2026-05-20T12:05:00.000Z',
          tags: ['ai', 'agents', 'research']
        }
      ]
    }
  });

  const stub = result.articleStubs[0];
  assert.ok(stub);
  const generatedText = [
    stub.dek,
    ...stub.bodySections.flatMap((section) => section.paragraphs),
    ...stub.keyTakeaways
  ].join('\n');
  const tweetSource = stub.sources.find((source) => source.url.includes('x.com/omarsar0/status'));

  assert.ok(tweetSource, 'expected retweet source');
  assert.equal(tweetSource.preview.kind, 'tweet');
  assert.equal(tweetSource.preview.label, 'Retweet');
  assert.equal(tweetSource.preview.social.kind, 'retweet');
  assert.equal(tweetSource.preview.social.originalAuthor, 'elvis');
  assert.equal(tweetSource.preview.social.quotedUrl, 'https://www.intology.ai/blog/nanogpt-bench');
  assert.doesNotMatch(generatedText, /\bRT\b/);
  assert.doesNotMatch(generatedText, /elvisVery/);
  assert.doesNotMatch(generatedText, /Read more here:\s*https?:\/\//i);
});
