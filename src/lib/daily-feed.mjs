import anthropicNews from '../data/precompiled/anthropic-news.json';
import anthropicResearch from '../data/precompiled/anthropic-research.json';
import googleNewsLatest from '../data/precompiled/google-news-latest.json';
import googleResearchBlog from '../data/precompiled/google-research-blog.json';
import githubOrganizations from '../data/precompiled/github-organizations.json';
import huggingFaceDailyPapers from '../data/precompiled/huggingface-daily-papers.json';
import metaResearch from '../data/precompiled/meta-research.json';
import publicationFeeds from '../data/precompiled/publication-feeds.json';
import sourceIndex from '../data/precompiled/source-index.json';
import twitterFeeds from '../data/precompiled/twitter-feeds.json';
import vercelAnnouncements from '../data/precompiled/vercel-announcements.json';
import xaiResearch from '../data/precompiled/xai-research.json';
import youtubeLatest from '../data/precompiled/youtube-latest.json';
import generatedDailyArticles from '../data/daily/generated-daily-articles.json';
import { buildDailyArticleStubs } from '../../scripts/lib/daily-article-stubs.mjs';
import {
  buildDailyArchiveSummary,
  normalizeArchivedDailyBriefs
} from '../../scripts/lib/daily-archive.mjs';
import { buildWeeklyLedgerFromPrecompiled } from '../../scripts/lib/precompiled-weekly-ledger.mjs';

const archiveModules = import.meta.glob('../data/daily/archive/*.json', { eager: true });

export const currentDailyDate = sourceIndex.generatedAt.slice(0, 10);

export const currentDailyLedger = buildWeeklyLedgerFromPrecompiled({
  generatedAt: sourceIndex.generatedAt,
  startDate: currentDailyDate,
  endDate: currentDailyDate,
  maxItems: 240,
  assets: {
    youtube: youtubeLatest,
    googleNews: googleNewsLatest,
    huggingFacePapers: huggingFaceDailyPapers,
    googleResearch: googleResearchBlog,
    anthropicResearch,
    anthropicNews,
    vercelAnnouncements,
    githubOrganizations,
    metaResearch,
    publicationFeeds,
    xaiResearch,
    twitterFeeds
  }
});

const computedCurrentBrief = buildDailyArticleStubs({
  date: currentDailyDate,
  ledger: currentDailyLedger,
  maxStubs: 18
});

export const archivedDailyBriefs = normalizeArchivedDailyBriefs(
  Object.values(archiveModules).map((module) => module.default ?? module)
);

export const archivedDailyBriefByDate = new Map(
  archivedDailyBriefs.map((brief) => [brief.date, brief])
);

export const currentDailyBrief = generatedDailyArticles?.date === currentDailyDate
  ? generatedDailyArticles
  : archivedDailyBriefByDate.get(currentDailyDate) ?? computedCurrentBrief;

export const latestPublishedDailyBrief = archivedDailyBriefs[0] ?? currentDailyBrief;

export const dailyBrief = hasPublishedArticles(currentDailyBrief)
  ? currentDailyBrief
  : latestPublishedDailyBrief;

export const dailyArchiveSummary = buildDailyArchiveSummary(archivedDailyBriefs);

function hasPublishedArticles(brief) {
  return Array.isArray(brief?.articleStubs) && brief.articleStubs.length > 0;
}
