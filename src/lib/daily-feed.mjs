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
import { buildWeeklyLedgerFromPrecompiled } from '../../scripts/lib/precompiled-weekly-ledger.mjs';

export const dailyDate = sourceIndex.generatedAt.slice(0, 10);

export const dailyLedger = buildWeeklyLedgerFromPrecompiled({
  generatedAt: sourceIndex.generatedAt,
  startDate: dailyDate,
  endDate: dailyDate,
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

const computedDailyBrief = buildDailyArticleStubs({
  date: dailyDate,
  ledger: dailyLedger,
  maxStubs: 18
});

export const dailyBrief = generatedDailyArticles?.date === dailyDate
  ? generatedDailyArticles
  : computedDailyBrief;
