import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDailyArticleStubsWithGenerationLoop } from './lib/daily-article-stubs.mjs';
import { buildWeeklyLedgerFromPrecompiled } from './lib/precompiled-weekly-ledger.mjs';

const repoRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const args = parseArgs(process.argv.slice(2));

const sourceIndex = readJson('src/data/precompiled/source-index.json');
const date = args.date ?? sourceIndex.generatedAt.slice(0, 10);
const maxStubs = Number(args.maxStubs ?? 18);
const maxEvalIterations = parseIntegerFlag(args['max-eval-iterations'], '--max-eval-iterations', { defaultValue: 3, min: 1 });
const minEvalScore = parseNumberFlag(args['min-eval-score'], '--min-eval-score', { defaultValue: 0.86, min: 0, max: 1 });

const assets = {
  youtube: readJson('src/data/precompiled/youtube-latest.json'),
  googleNews: readJson('src/data/precompiled/google-news-latest.json'),
  huggingFacePapers: readJson('src/data/precompiled/huggingface-daily-papers.json'),
  googleResearch: readJson('src/data/precompiled/google-research-blog.json'),
  anthropicResearch: readJson('src/data/precompiled/anthropic-research.json'),
  anthropicNews: readJson('src/data/precompiled/anthropic-news.json'),
  vercelAnnouncements: readJson('src/data/precompiled/vercel-announcements.json'),
  githubOrganizations: readJson('src/data/precompiled/github-organizations.json'),
  metaResearch: readJson('src/data/precompiled/meta-research.json'),
  publicationFeeds: readJson('src/data/precompiled/publication-feeds.json'),
  xaiResearch: readJson('src/data/precompiled/xai-research.json'),
  twitterFeeds: readJson('src/data/precompiled/twitter-feeds.json')
};

const ledger = buildWeeklyLedgerFromPrecompiled({
  generatedAt: sourceIndex.generatedAt,
  startDate: date,
  endDate: date,
  maxItems: Number(args.maxItems ?? 240),
  assets
});

const dailyBrief = await buildDailyArticleStubsWithGenerationLoop({
  date,
  ledger,
  maxStubs,
  evalMode: args['eval-mode'] ?? 'live',
  maxEvalIterations,
  minEvalScore,
  linkCheck: args['link-check'] ?? 'syntax'
});

const payload = {
  ...dailyBrief,
  voice: args.voice ?? 'tk-technews-journalist'
};

writeJson('src/data/daily/generated-daily-articles.json', payload);
writeJson('public/daily/generated-daily-articles.json', payload);

console.log(JSON.stringify({
  date,
  articles: payload.articleStubs.length,
  sourceItemCount: payload.sourceItemCount,
  output: [
    'src/data/daily/generated-daily-articles.json',
    'public/daily/generated-daily-articles.json'
  ]
}, null, 2));

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(repoRoot, relativePath), 'utf8'));
}

function writeJson(relativePath, value) {
  const path = join(repoRoot, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
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

function parseIntegerFlag(value, flagName, { defaultValue, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined) return defaultValue;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${flagName} must be an integer between ${min} and ${max}; received "${value}".`);
  }
  return parsed;
}

function parseNumberFlag(value, flagName, { defaultValue, min = -Infinity, max = Infinity } = {}) {
  if (value === undefined) return defaultValue;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${flagName} must be a number between ${min} and ${max}; received "${value}".`);
  }
  return parsed;
}
