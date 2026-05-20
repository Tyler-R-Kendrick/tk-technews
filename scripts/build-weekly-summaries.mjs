import fs from 'node:fs/promises';
import path from 'node:path';
import { buildWeeklyLedgerFromPrecompiled } from './lib/precompiled-weekly-ledger.mjs';

const args = new Map(process.argv.slice(2).map((arg, index, all) => {
  if (!arg.startsWith('--')) return [];
  const next = all[index + 1];
  return [arg.slice(2), next && !next.startsWith('--') ? next : 'true'];
}).filter(Boolean));

const root = process.cwd();
const generatedAt = new Date().toISOString();
const endDate = args.get('end') ?? generatedAt.slice(0, 10);
const startDate = args.get('start') ?? daysBefore(endDate, 7);
const maxItems = Number(args.get('limit') ?? 120);
const assets = await readPrecompiledAssets(root);

const ledger = buildWeeklyLedgerFromPrecompiled({
  generatedAt,
  startDate,
  endDate,
  assets,
  maxItems
});

const outputDir = path.join(root, 'data', 'summaries');
await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(path.join(outputDir, 'latest.json'), `${JSON.stringify(ledger, null, 2)}\n`);

console.log(`Wrote ${ledger.itemCount} weekly summaries from ${ledger.sourceCount} monitored sources to data/summaries/latest.json`);
console.log(`Window: ${startDate} through ${endDate}`);

async function readPrecompiledAssets(rootDir) {
  return {
    youtube: await readJson(rootDir, 'youtube-latest.json'),
    googleNews: await readJson(rootDir, 'google-news-latest.json'),
    huggingFacePapers: await readJson(rootDir, 'huggingface-daily-papers.json'),
    googleResearch: await readJson(rootDir, 'google-research-blog.json'),
    anthropicResearch: await readJson(rootDir, 'anthropic-research.json'),
    anthropicNews: await readJson(rootDir, 'anthropic-news.json'),
    vercelAnnouncements: await readJson(rootDir, 'vercel-announcements.json'),
    githubOrganizations: await readJson(rootDir, 'github-organizations.json'),
    metaResearch: await readJson(rootDir, 'meta-research.json'),
    publicationFeeds: await readJson(rootDir, 'publication-feeds.json'),
    xaiResearch: await readJson(rootDir, 'xai-research.json'),
    twitterFeeds: await readJson(rootDir, 'twitter-feeds.json')
  };
}

async function readJson(rootDir, fileName) {
  return JSON.parse(await fs.readFile(path.join(rootDir, 'src', 'data', 'precompiled', fileName), 'utf8'));
}

function daysBefore(dateText, days) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}
