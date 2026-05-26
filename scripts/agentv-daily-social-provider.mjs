import fs from 'node:fs/promises';
import { buildDailyArticleStubsWithGenerationLoop } from './lib/daily-article-stubs.mjs';

export async function runDailySocialFixture(fixtureId) {
  if (!['retweet-quote', 'title-echo-quality', 'source-grounding-regression'].includes(fixtureId)) throw new Error(`Unknown daily social fixture: ${fixtureId}`);
  const result = await buildDailyArticleStubsWithGenerationLoop({
    date: '2026-05-20',
    ledger: {
      generatedAt: '2026-05-20T18:00:00.000Z',
      items: fixtureItems(fixtureId)
    },
    maxStubs: 1
  });

  return {
    outputKind: 'daily_stub',
    stub: result.articleStubs[0],
    sourceItemCount: result.sourceItemCount
  };
}

function fixtureItems(fixtureId) {
  if (fixtureId === 'source-grounding-regression') {
    return [
      {
        id: 'self-evolving-skills',
        title: 'Self Evolving AI Skills w/ GPT-5.5 (SkillOpt)',
        summary: 'No usable text was extracted from this source.',
        url: 'https://www.youtube.com/watch?v=self-evolving-skills',
        sourceName: 'Discover AI',
        publishedAt: '2026-05-20T13:15:14.000Z',
        tags: ['youtube', 'self evolving', 'skillopt']
      }
    ];
  }
  if (fixtureId === 'title-echo-quality') {
    return [
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
    ];
  }
  return [
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
      ];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['output-file']) return;
  const prompt = args['prompt-file'] ? await fs.readFile(args['prompt-file'], 'utf8') : '';
  const fixtureId = fixtureIdFromPrompt(prompt);
  const result = await runDailySocialFixture(fixtureId);
  await fs.writeFile(args['output-file'], JSON.stringify({
    text: JSON.stringify(result)
  }, null, 2));
}

function fixtureIdFromPrompt(prompt) {
  const match = String(prompt).match(/fixture:\s*([a-z0-9-]+)/i);
  return match?.[1] ?? 'retweet-quote';
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]?.startsWith('--') ? argv[index].slice(2) : null;
    if (!key) continue;
    parsed[key] = argv[index + 1];
    index += 1;
  }
  return parsed;
}

await main();
