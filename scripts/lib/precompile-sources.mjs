import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import { callTranscriptTool, extractYouTubeVideoId } from '../../servers/youtube-transcript-mcp/transcript-client.mjs';
import { summarizeText } from './text-utils.mjs';

const parser = new Parser({
  timeout: 20000,
  headers: {
    'user-agent': 'tk-technews source precompiler; local research agent'
  }
});

export function monitoredSourceSummary(config) {
  const youtubeCategories = Object.fromEntries(
    Object.entries(config.youtube ?? {}).map(([category, handles]) => [category, handles.length])
  );

  return {
    youtubeCategories,
    youtubeTotal: Object.values(youtubeCategories).reduce((sum, count) => sum + count, 0),
    googleNewsTopics: (config.googleNewsTopics ?? []).length,
    huggingFaceDailyPapers: Boolean(config.huggingFaceDailyPapers),
    googleResearchBlog: Boolean(config.googleResearchBlog),
    anthropicResearch: Boolean(config.anthropicResearch),
    anthropicNews: Boolean(config.anthropicNews),
    vercelAnnouncementFeeds: (config.vercelAnnouncements?.feeds ?? []).length,
    githubOrganizations: (config.githubOrganizations ?? []).length,
    metaResearchFeeds: (config.metaResearchFeeds ?? []).length,
    metaAiResearch: Boolean(config.metaAiResearch),
    publicationFeeds: (config.publicationFeeds ?? []).length,
    xaiResearchFeeds: (config.xaiResearchFeeds?.queries ?? []).length,
    twitterProfiles: (config.twitterProfiles?.handles ?? []).length
  };
}

export function normalizeYouTubeHandle(handle) {
  return String(handle).trim().replace(/^@/, '');
}

export function flattenYouTubeSources(categories) {
  return Object.entries(categories ?? {}).flatMap(([category, handles]) =>
    handles.map((handle) => {
      const normalizedHandle = normalizeYouTubeHandle(handle);
      return {
        id: `youtube-${slugify(category)}-${slugify(normalizedHandle)}`,
        category,
        handle,
        normalizedHandle,
        channelUrl: `https://www.youtube.com/@${normalizedHandle}`
      };
    })
  );
}

export function googleNewsRssUrl(topic) {
  const url = new URL('https://news.google.com/rss/search');
  url.searchParams.set('q', topic);
  url.searchParams.set('hl', 'en-US');
  url.searchParams.set('gl', 'US');
  url.searchParams.set('ceid', 'US:en');
  return url.toString();
}

export function googleNewsSources(topics) {
  return topics.map((topic) => ({
    id: `google-news-${slugify(topic)}`,
    topic,
    rssUrl: googleNewsRssUrl(topic)
  }));
}

export function huggingFaceDailyPapersApiUrl({ date, limit = 20 } = {}) {
  const url = new URL('https://huggingface.co/api/daily_papers');
  url.searchParams.set('p', '0');
  url.searchParams.set('limit', String(limit));
  if (date) {
    url.searchParams.set('date', date);
  }
  url.searchParams.set('sort', 'publishedAt');
  return url.toString();
}

export function huggingFaceDailyPapersSource(config = {}) {
  const date = config.date ?? new Date().toISOString().slice(0, 10);
  const limit = Number(config.limit ?? 20);
  return {
    id: `huggingface-daily-papers-${date}`,
    category: 'academics',
    date,
    limit,
    title: 'Hugging Face Daily Papers',
    sourceUrl: `https://huggingface.co/papers/date/${date}`,
    apiUrl: huggingFaceDailyPapersApiUrl({ date, limit })
  };
}

export function googleResearchBlogSource(config = {}) {
  return {
    id: 'google-research-blog',
    category: 'research',
    title: 'Google Research Blog',
    sourceUrl: config.url ?? 'https://research.google/blog/',
    rssUrl: config.rssUrl ?? 'https://research.google/blog/rss/',
    limit: Number(config.limit ?? 10)
  };
}

export function anthropicResearchSource(config = {}) {
  return {
    id: 'anthropic-research',
    category: 'research',
    title: 'Anthropic Research',
    sourceUrl: config.url ?? 'https://www.anthropic.com/research',
    limit: Number(config.limit ?? 10)
  };
}

export function anthropicNewsSource(config = {}) {
  return {
    id: 'anthropic-news',
    category: 'news',
    title: 'Anthropic News',
    sourceUrl: config.url ?? 'https://www.anthropic.com/news',
    limit: Number(config.limit ?? 10)
  };
}

export function vercelAnnouncementSources(config = {}) {
  return (config.feeds ?? []).map((feed) => ({
    id: feed.id,
    category: 'announcements',
    title: feed.title,
    sourceUrl: feed.url,
    rssUrl: feed.rssUrl,
    limit: Number(feed.limit ?? config.limit ?? 10)
  }));
}

export function githubOrganizationSources(config = []) {
  return config.map((source) => {
    const organization = source.organization ?? source.id;
    const limit = Number(source.limit ?? 12);
    const apiUrl = new URL(`https://api.github.com/orgs/${organization}/repos`);
    apiUrl.searchParams.set('sort', 'updated');
    apiUrl.searchParams.set('per_page', String(limit));

    return {
      id: `github-${organization}`,
      category: 'github',
      title: `${organization} GitHub`,
      organization,
      sourceUrl: source.url ?? `https://github.com/${organization}`,
      apiUrl: apiUrl.toString(),
      limit
    };
  });
}

export function metaResearchFeedSources(config = []) {
  return config.map((feed) => ({
    id: feed.id,
    category: 'research',
    title: feed.title,
    sourceUrl: feed.url,
    rssUrl: feed.rssUrl,
    limit: Number(feed.limit ?? 10)
  }));
}

export function metaAiResearchSource(config = {}) {
  return {
    id: 'meta-ai-research',
    category: 'research',
    title: 'Meta AI Research',
    sourceUrl: config.url ?? 'https://ai.meta.com/research/',
    limit: Number(config.limit ?? 1)
  };
}

export function publicationFeedSources(config = []) {
  return config.map((feed) => ({
    id: feed.id,
    category: 'publications',
    title: feed.title,
    sourceUrl: feed.url,
    rssUrl: feed.rssUrl,
    limit: Number(feed.limit ?? 10)
  }));
}

export function xaiResearchFeedSources(config = {}) {
  return (config.queries ?? []).map((query) => ({
    id: query.id,
    category: 'research',
    title: query.title,
    sourceUrl: query.url,
    query: query.query,
    rssUrl: googleNewsRssUrl(query.query),
    limit: Number(query.limit ?? config.limit ?? 10)
  }));
}

export function twitterProfileSources(config = {}) {
  const provider = String(config.provider ?? 'rsshub');
  const rssBaseUrl = String(config.rssBaseUrl ?? 'https://rsshub-boost.23751.net').replace(/\/$/, '');
  const limit = Number(config.limit ?? 5);
  const timeoutMs = Number(config.timeoutMs ?? 15000);
  return (config.handles ?? []).map((handle) => {
    const normalizedHandle = normalizeYouTubeHandle(handle);
    const rssPath = provider === 'rsshub'
      ? `/twitter/user/${encodeURIComponent(normalizedHandle)}`
      : `/${encodeURIComponent(normalizedHandle)}/rss`;
    return {
      id: `twitter-${slugify(normalizedHandle)}`,
      category: 'twitter',
      provider,
      handle,
      normalizedHandle,
      title: `@${normalizedHandle}`,
      sourceUrl: `https://x.com/${normalizedHandle}`,
      rssUrl: `${rssBaseUrl}${rssPath}`,
      limit,
      timeoutMs
    };
  });
}

export async function precompileSources(config, options = {}) {
  const now = options.generatedAt ?? new Date().toISOString();
  const youtubeSources = flattenYouTubeSources(config.youtube);
  const googleSources = googleNewsSources(config.googleNewsTopics ?? []);
  const huggingFaceDailyPapers = config.huggingFaceDailyPapers
    ? huggingFaceDailyPapersSource(config.huggingFaceDailyPapers)
    : null;
  const googleResearchBlog = config.googleResearchBlog ? googleResearchBlogSource(config.googleResearchBlog) : null;
  const anthropicResearch = config.anthropicResearch ? anthropicResearchSource(config.anthropicResearch) : null;
  const anthropicNews = config.anthropicNews ? anthropicNewsSource(config.anthropicNews) : null;
  const vercelAnnouncements = vercelAnnouncementSources(config.vercelAnnouncements);
  const githubOrganizations = githubOrganizationSources(config.githubOrganizations ?? []);
  const metaResearchFeeds = metaResearchFeedSources(config.metaResearchFeeds ?? []);
  const metaAiResearch = config.metaAiResearch ? metaAiResearchSource(config.metaAiResearch) : null;
  const publicationFeeds = publicationFeedSources(config.publicationFeeds ?? []);
  const xaiResearchFeeds = xaiResearchFeedSources(config.xaiResearchFeeds);
  const twitterProfiles = twitterProfileSources(config.twitterProfiles);
  const maxItems = Number(options.maxItems ?? 10);
  const concurrency = Number(options.concurrency ?? 4);

  const [
    youtube,
    googleNews,
    huggingFacePapers,
    googleResearch,
    anthropic,
    anthropicNewsResult,
    vercel,
    github,
    metaResearch,
    metaAi,
    publications,
    xaiResearch,
    twitter
  ] = await Promise.all([
    mapConcurrent(youtubeSources, concurrency, (source) => fetchYouTubeSource(source, { maxItems, now })),
    mapConcurrent(googleSources, concurrency, (source) => fetchGoogleNewsSource(source, { maxItems, now })),
    huggingFaceDailyPapers
      ? fetchHuggingFaceDailyPapers(huggingFaceDailyPapers, { maxItems: huggingFaceDailyPapers.limit, now })
      : null,
    googleResearchBlog
      ? fetchGoogleResearchBlog(googleResearchBlog, { maxItems: googleResearchBlog.limit, now })
      : null,
    anthropicResearch
      ? fetchAnthropicResearch(anthropicResearch, { maxItems: anthropicResearch.limit, now })
      : null,
    anthropicNews
      ? fetchAnthropicNews(anthropicNews, { maxItems: anthropicNews.limit, now })
      : null,
    mapConcurrent(vercelAnnouncements, concurrency, (source) => fetchVercelAnnouncementSource(source, { maxItems: source.limit, now })),
    mapConcurrent(githubOrganizations, concurrency, (source) => fetchGitHubOrganizationSource(source, { maxItems: source.limit, now })),
    mapConcurrent(metaResearchFeeds, concurrency, (source) => fetchMetaResearchFeedSource(source, { maxItems: source.limit, now })),
    metaAiResearch
      ? fetchMetaAiResearchSource(metaAiResearch, { maxItems: metaAiResearch.limit, now })
      : null,
    mapConcurrent(publicationFeeds, concurrency, (source) => fetchPublicationFeedSource(source, { maxItems: source.limit, now })),
    mapConcurrent(xaiResearchFeeds, concurrency, (source) => fetchXaiResearchFeedSource(source, { maxItems: source.limit, now })),
    mapConcurrent(twitterProfiles, concurrency, (source) => fetchTwitterProfileSource(source, {
      maxItems: source.limit,
      now,
      timeoutMs: options.twitterTimeoutMs ?? source.timeoutMs ?? 15000
    }))
  ]);

  return {
    generatedAt: now,
    summary: {
      ...monitoredSourceSummary(config),
      youtubeOk: youtube.filter((source) => source.status === 'ok').length,
      googleNewsOk: googleNews.filter((source) => source.status === 'ok').length,
      huggingFacePapersOk: huggingFacePapers?.status === 'ok' ? 1 : 0,
      googleResearchOk: googleResearch?.status === 'ok' ? 1 : 0,
      anthropicResearchOk: anthropic?.status === 'ok' ? 1 : 0,
      anthropicNewsOk: anthropicNewsResult?.status === 'ok' ? 1 : 0,
      vercelAnnouncementsOk: vercel.filter((source) => source.status === 'ok').length,
      githubOrganizationsOk: github.filter((source) => source.status === 'ok').length,
      metaResearchOk: metaResearch.filter((source) => source.status === 'ok').length,
      metaAiResearchOk: metaAi?.status === 'ok' ? 1 : 0,
      publicationFeedsOk: publications.filter((source) => source.status === 'ok').length,
      xaiResearchFeedsOk: xaiResearch.filter((source) => source.status === 'ok').length,
      twitterProfilesOk: twitter.filter((source) => source.status === 'ok').length
    },
    youtube,
    googleNews,
    huggingFacePapers,
    googleResearch,
    anthropic,
    anthropicNews: anthropicNewsResult,
    vercel,
    github,
    metaResearch,
    metaAi,
    publications,
    xaiResearch,
    twitter
  };
}

export async function fetchGoogleNewsSource(source, options = {}) {
  try {
    const feed = await parser.parseURL(source.rssUrl);
    return {
      ...source,
      status: 'ok',
      fetchedAt: options.now ?? new Date().toISOString(),
      title: feed.title ?? source.topic,
      items: normalizeFeedItems(feed.items, options.maxItems)
    };
  } catch (error) {
    return failedSource(source, error, options.now);
  }
}

export async function fetchYouTubeSource(source, options = {}) {
  try {
    const channel = await resolveYouTubeChannel(source.channelUrl);
    const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channel.channelId}`;
    const feed = await parser.parseURL(feedUrl);

    const items = await enrichYouTubeItemsWithTranscripts(normalizeFeedItems(feed.items, options.maxItems), {
      transcriptFetcher: options.transcriptFetcher,
      transcriptLanguages: options.transcriptLanguages,
      transcriptEnabled: options.transcriptEnabled,
      maxTranscriptItems: options.maxTranscriptItems
    });

    return {
      ...source,
      ...channel,
      feedUrl,
      status: 'ok',
      fetchedAt: options.now ?? new Date().toISOString(),
      title: feed.title ?? channel.title ?? source.handle,
      items
    };
  } catch (error) {
    return failedSource(source, error, options.now);
  }
}

export async function enrichYouTubeItemsWithTranscripts(items, options = {}) {
  if (options.transcriptEnabled === false) return items;

  const transcriptFetcher = options.transcriptFetcher ?? ((input) => callTranscriptTool({ action: 'fetch', ...input }));
  const maxTranscriptItems = Number(options.maxTranscriptItems ?? items.length);
  const languages = options.transcriptLanguages ?? ['en', 'en-US'];
  const enriched = [];

  for (const [index, item] of items.entries()) {
    if (index >= maxTranscriptItems || !isYouTubeUrl(item.link)) {
      enriched.push(item);
      continue;
    }

    try {
      const result = await transcriptFetcher({
        idOrUrl: item.link,
        languages,
        transcript_type: 'any',
        format: 'text'
      });
      const text = normalizeTranscriptText(result.transcript);
      const transcriptSummary = summarizeTranscriptText(text);
      enriched.push({
        ...item,
        summary: item.summary || transcriptSummary,
        transcriptSummary,
        transcript: {
          videoId: result.video_id ?? safeYouTubeVideoId(item.link),
          languageCode: result.language_code ?? null,
          isGenerated: Boolean(result.is_generated),
          status: 'ok',
          text
        }
      });
    } catch (error) {
      enriched.push({
        ...item,
        transcript: {
          videoId: safeYouTubeVideoId(item.link),
          status: 'unavailable',
          reason: error.message
        }
      });
    }
  }

  return enriched;
}

export async function fetchHuggingFaceDailyPapers(source, options = {}) {
  try {
    const response = await fetch(source.apiUrl, {
      headers: {
        'accept': 'application/json',
        'user-agent': 'tk-technews source precompiler; local research agent'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching ${source.apiUrl}`);
    }

    const papers = await response.json();
    return {
      ...source,
      status: 'ok',
      fetchedAt: options.now ?? new Date().toISOString(),
      items: normalizeHuggingFaceDailyPapers(papers, options.maxItems)
    };
  } catch (error) {
    return failedSource(source, error, options.now);
  }
}

export async function fetchGoogleResearchBlog(source, options = {}) {
  try {
    const feed = await parser.parseURL(source.rssUrl);
    return {
      ...source,
      status: 'ok',
      fetchedAt: options.now ?? new Date().toISOString(),
      title: feed.title ?? source.title,
      items: normalizeGoogleResearchBlogItems(feed.items, options.maxItems)
    };
  } catch (error) {
    return failedSource(source, error, options.now);
  }
}

export async function fetchVercelAnnouncementSource(source, options = {}) {
  try {
    const feed = await parser.parseURL(source.rssUrl);
    return {
      ...source,
      status: 'ok',
      fetchedAt: options.now ?? new Date().toISOString(),
      title: feed.title ?? source.title,
      items: normalizeVercelAnnouncementItems(feed.items, source, options.maxItems)
    };
  } catch (error) {
    return failedSource(source, error, options.now);
  }
}

export async function fetchMetaResearchFeedSource(source, options = {}) {
  try {
    const feed = await parser.parseURL(source.rssUrl);
    return {
      ...source,
      status: 'ok',
      fetchedAt: options.now ?? new Date().toISOString(),
      title: feed.title ?? source.title,
      items: normalizeMetaResearchFeedItems(feed.items, source, options.maxItems)
    };
  } catch (error) {
    return failedSource(source, error, options.now);
  }
}

export async function fetchPublicationFeedSource(source, options = {}) {
  try {
    const response = await fetch(source.rssUrl, {
      headers: {
        'accept': 'application/rss+xml, application/xml, text/xml',
        'user-agent': 'tk-technews source precompiler; local research agent'
      },
      signal: AbortSignal.timeout(Number(options.timeoutMs ?? 20000))
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching ${source.rssUrl}`);
    }

    const xml = await response.text();
    if (!xml.trim()) {
      throw new Error(`Empty RSS response from ${source.rssUrl}`);
    }

    return {
      ...source,
      status: 'ok',
      fetchedAt: options.now ?? new Date().toISOString(),
      items: normalizePublicationRssXml(xml, source, options.maxItems)
    };
  } catch (error) {
    return failedSource(source, error, options.now);
  }
}

export async function fetchXaiResearchFeedSource(source, options = {}) {
  try {
    const feed = await parser.parseURL(source.rssUrl);
    return {
      ...source,
      status: 'ok',
      fetchedAt: options.now ?? new Date().toISOString(),
      title: feed.title ?? source.title,
      items: normalizeXaiResearchFeedItems(feed.items, source, options.maxItems)
    };
  } catch (error) {
    return failedSource(source, error, options.now);
  }
}

export async function fetchTwitterProfileSource(source, options = {}) {
  try {
    const response = await fetch(source.rssUrl, {
      headers: {
        'accept': 'application/rss+xml, application/xml, text/xml',
        'user-agent': 'tk-technews source precompiler; local research agent'
      },
      signal: AbortSignal.timeout(Number(options.timeoutMs ?? 8000))
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching ${source.rssUrl}`);
    }

    const xml = await response.text();
    return {
      ...source,
      status: 'ok',
      fetchedAt: options.now ?? new Date().toISOString(),
      items: normalizeTwitterProfileRssXml(xml, source, options.maxItems)
    };
  } catch (error) {
    return failedSource(source, error, options.now);
  }
}

export async function fetchMetaAiResearchSource(source, options = {}) {
  try {
    const response = await fetch(source.sourceUrl, {
      headers: {
        'accept': 'text/html',
        'user-agent': 'tk-technews source precompiler; local research agent'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching ${source.sourceUrl}`);
    }

    const html = await response.text();
    return {
      ...source,
      status: 'ok',
      fetchedAt: options.now ?? new Date().toISOString(),
      items: normalizeMetaAiResearchItems(html, source).slice(0, options.maxItems)
    };
  } catch (error) {
    return failedSource(source, error, options.now);
  }
}

export async function fetchGitHubOrganizationSource(source, options = {}) {
  try {
    const response = await fetch(source.apiUrl, {
      headers: {
        'accept': 'application/vnd.github+json',
        'user-agent': 'tk-technews source precompiler; local research agent'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching ${source.apiUrl}`);
    }

    const repos = await response.json();
    return {
      ...source,
      status: 'ok',
      fetchedAt: options.now ?? new Date().toISOString(),
      items: normalizeGitHubOrganizationRepos(repos, options.maxItems)
    };
  } catch (error) {
    return failedSource(source, error, options.now);
  }
}

export async function fetchAnthropicResearch(source, options = {}) {
  return fetchAnthropicIndex(source, {
    ...options,
    basePath: '/research/',
    indexPath: '/research'
  });
}

export async function fetchAnthropicNews(source, options = {}) {
  return fetchAnthropicIndex(source, {
    ...options,
    basePath: '/news/',
    indexPath: '/news'
  });
}

async function fetchAnthropicIndex(source, options = {}) {
  try {
    const response = await fetch(source.sourceUrl, {
      headers: {
        'accept': 'text/html',
        'user-agent': 'tk-technews source precompiler; local research agent'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching ${source.sourceUrl}`);
    }

    const html = await response.text();
    return {
      ...source,
      status: 'ok',
      fetchedAt: options.now ?? new Date().toISOString(),
      items: normalizeAnthropicIndexItems(html, {
        basePath: options.basePath,
        indexPath: options.indexPath,
        maxItems: options.maxItems
      })
    };
  } catch (error) {
    return failedSource(source, error, options.now);
  }
}

export async function resolveYouTubeChannel(channelUrl) {
  const response = await fetch(channelUrl, {
    headers: {
      'user-agent': 'Mozilla/5.0 tk-technews source precompiler'
    },
    redirect: 'follow'
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} resolving ${channelUrl}`);
  }

  const html = await response.text();
  const channelId =
    firstMatch(html, /"channelId":"(UC[A-Za-z0-9_-]+)"/) ??
    firstMatch(html, /"externalId":"(UC[A-Za-z0-9_-]+)"/) ??
    firstMatch(html, /youtube\.com\/channel\/(UC[A-Za-z0-9_-]+)/);
  const title =
    firstMatch(html, /<meta property="og:title" content="([^"]+)"/) ??
    firstMatch(html, /"title":"([^"]+)"/);

  if (!channelId) {
    throw new Error(`Could not resolve channel id from ${channelUrl}`);
  }

  return {
    channelId,
    title: decodeHtml(title ?? '')
  };
}

function normalizeFeedItems(items, maxItems = 10) {
  return (items ?? []).slice(0, maxItems).map((item) => ({
    title: item.title ?? '',
    link: item.link ?? '',
    id: item.id ?? item.guid ?? item.link ?? '',
    publishedAt: item.isoDate ?? item.pubDate ?? null,
    author: item.creator ?? item.author ?? null,
    summary: item.contentSnippet ?? item.summary ?? ''
  }));
}

function isYouTubeUrl(value) {
  return /(?:youtube\.com|youtu\.be)\//i.test(String(value ?? ''));
}

function safeYouTubeVideoId(value) {
  try {
    return extractYouTubeVideoId(value);
  } catch {
    return null;
  }
}

function normalizeTranscriptText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function summarizeTranscriptText(text) {
  const sentences = normalizeTranscriptText(text)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 35);
  const priority = sentences.filter((sentence) =>
    /\b(recurrent|recurrence|memory consolidation|long-running|llm agents?|semantic memory|episodic memory|phase transition)\b/i.test(sentence)
  );
  const selected = uniqueStrings([...sentences.slice(0, 2), ...priority]).slice(0, 5);
  return selected.length > 0 ? selected.join(' ') : summarizeText(text, 4);
}

function uniqueStrings(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function normalizeHuggingFaceDailyPapers(items, maxItems = 20) {
  return (items ?? []).slice(0, maxItems).map((item) => {
    const paper = item.paper ?? item;
    const paperId = paper.id ?? item.id ?? '';
    const authors = (paper.authors ?? [])
      .filter((author) => !author.hidden)
      .map((author) => author.name)
      .filter(Boolean);

    return {
      title: paper.title ?? item.title ?? '',
      link: paperId ? `https://huggingface.co/papers/${paperId}` : '',
      id: paperId,
      publishedAt: paper.publishedAt ?? item.publishedAt ?? null,
      submittedAt: paper.submittedOnDailyAt ?? item.publishedAt ?? null,
      author: authors.slice(0, 3).join(', '),
      authors,
      summary: paper.ai_summary ?? paper.summary ?? item.summary ?? '',
      upvotes: Number(paper.upvotes ?? 0),
      comments: Number(item.numComments ?? 0),
      thumbnail: item.thumbnail ?? null,
      projectPage: paper.projectPage ?? null,
      githubRepo: paper.githubRepo ?? null,
      keywords: paper.ai_keywords ?? []
    };
  });
}

export function normalizeGoogleResearchBlogItems(items, maxItems = 10) {
  return (items ?? []).slice(0, maxItems).map((item) => ({
    title: item.title ?? '',
    link: item.link ?? '',
    id: item.id ?? item.guid ?? item.link ?? '',
    publishedAt: item.isoDate ?? item.pubDate ?? null,
    author: item.creator ?? item.author ?? 'Google Research',
    summary: item.contentSnippet ?? item.summary ?? '',
    categories: item.categories ?? []
  }));
}

export function normalizeVercelAnnouncementItems(items, source = {}, maxItems = 10) {
  return (items ?? []).slice(0, maxItems).map((item) => ({
    title: item.title ?? '',
    link: item.link ?? '',
    id: item.id ?? item.guid ?? item.link ?? '',
    publishedAt: item.isoDate ?? item.pubDate ?? null,
    author: item.creator ?? item.author ?? 'Vercel',
    summary: item.contentSnippet ?? item.summary ?? '',
    source: source.title ?? 'Vercel'
  }));
}

export function normalizeMetaResearchFeedItems(items, source = {}, maxItems = 10) {
  return (items ?? []).slice(0, maxItems).map((item) => ({
    title: item.title ?? '',
    link: item.link ?? '',
    id: item.id ?? item.guid ?? item.link ?? '',
    publishedAt: item.isoDate ?? item.pubDate ?? null,
    author: item.creator ?? item.author ?? 'Meta Research',
    summary: item.contentSnippet ?? item.summary ?? '',
    categories: cleanCategories(item.categories ?? []),
    source: source.title ?? 'Meta Research'
  }));
}

export function normalizePublicationFeedItems(items, source = {}, maxItems = 10) {
  return (items ?? []).slice(0, maxItems).map((item) => ({
    title: item.title ?? '',
    link: item.link ?? '',
    id: item.id ?? item.guid ?? item.link ?? '',
    publishedAt: item.isoDate ?? item.pubDate ?? null,
    author: item.creator ?? item.author ?? source.title ?? null,
    summary: item.contentSnippet ?? item.summary ?? '',
    categories: cleanCategories(item.categories ?? []),
    source: source.title ?? 'Publication Feed'
  }));
}

export function normalizePublicationRssXml(xml, source = {}, maxItems = 10) {
  return [...String(xml).matchAll(/<item\b[\s\S]*?<\/item>/gi)]
    .slice(0, maxItems)
    .map((match) => {
      const $ = cheerio.load(match[0], { xmlMode: true });
      const title = $('title').first().text().trim();
      const link = $('link').first().text().trim();
      const guid = $('guid').first().text().trim();
      const pubDate = $('pubDate').first().text().trim();
      const author = $('dc\\:creator').first().text().trim() || $('author').first().text().trim();
      const summary = $('description').first().text().replace(/\s+/g, ' ').trim();
      const categories = $('category')
        .map((_, category) => $(category).text())
        .get();

      return {
        title,
        link,
        id: guid || link,
        publishedAt: dateToIso(pubDate) ?? (pubDate || null),
        author: author || source.title || null,
        summary,
        categories: cleanCategories(categories),
        source: source.title ?? 'Publication Feed'
      };
    });
}

export function normalizeXaiResearchFeedItems(items, source = {}, maxItems = 10) {
  return (items ?? []).slice(0, maxItems).map((item) => ({
    title: item.title ?? '',
    link: item.link ?? '',
    id: item.id ?? item.guid ?? item.link ?? '',
    publishedAt: item.isoDate ?? item.pubDate ?? null,
    author: item.creator ?? item.author ?? 'xAI',
    summary: item.contentSnippet ?? item.summary ?? '',
    source: source.title ?? 'xAI Research'
  }));
}

export function normalizeTwitterProfileRssXml(xml, source = {}, maxItems = 5) {
  return [...String(xml).matchAll(/<item\b[\s\S]*?<\/item>/gi)]
    .slice(0, maxItems)
    .map((match) => {
      const $ = cheerio.load(match[0], { xmlMode: true });
      const title = stripHtml($('title').first().text()).trim();
      const link = $('link').first().text().trim();
      const guid = $('guid').first().text().trim();
      const pubDate = $('pubDate').first().text().trim();
      const summary = stripHtml($('description').first().text()).replace(/\s+/g, ' ').trim();

      return {
        title,
        link: normalizeTwitterLink(link, source.normalizedHandle),
        id: guid || link,
        publishedAt: dateToIso(pubDate) ?? (pubDate || null),
        author: source.title ?? null,
        summary,
        source: source.title ?? 'X'
      };
    });
}

export function normalizeMetaAiResearchItems(html, source = {}) {
  const $ = cheerio.load(html);
  const title = (
    $('meta[property="og:title"]').attr('content') ??
    $('meta[name="title"]').attr('content') ??
    source.title ??
    ''
  ).replace(/\s+\|\s+AI at Meta$/, '');
  const summary =
    $('meta[property="og:description"]').attr('content') ??
    $('meta[name="description"]').attr('content') ??
    '';
  const link =
    $('script[type="application/ld+json"]')
      .map((_, script) => jsonLdUrl($(script).text()))
      .get()
      .find(Boolean) ??
    source.sourceUrl ??
    'https://ai.meta.com/research/';

  return title ? [{
    title,
    link,
    id: link,
    publishedAt: null,
    author: 'Meta AI',
    summary,
    categories: ['AI Research'],
    source: source.title ?? 'Meta AI Research'
  }] : [];
}

export function normalizeGitHubOrganizationRepos(repos, maxItems = 12) {
  return (repos ?? []).slice(0, maxItems).map((repo) => ({
    title: repo.full_name ?? repo.name ?? '',
    link: repo.html_url ?? '',
    id: repo.id ? String(repo.id) : repo.html_url ?? repo.name ?? '',
    publishedAt: repo.pushed_at ?? repo.updated_at ?? null,
    updatedAt: repo.updated_at ?? null,
    author: repo.owner?.login ?? null,
    summary: repo.description ?? '',
    stars: Number(repo.stargazers_count ?? 0),
    forks: Number(repo.forks_count ?? 0),
    language: repo.language ?? null,
    openIssues: Number(repo.open_issues_count ?? 0)
  }));
}

export function normalizeAnthropicResearchItems(html, { maxItems = 10 } = {}) {
  return normalizeAnthropicIndexItems(html, {
    basePath: '/research/',
    indexPath: '/research',
    maxItems
  });
}

export function normalizeAnthropicNewsItems(html, { maxItems = 10 } = {}) {
  return normalizeAnthropicIndexItems(html, {
    basePath: '/news/',
    indexPath: '/news',
    maxItems
  });
}

function normalizeAnthropicIndexItems(html, { basePath, indexPath, maxItems = 10 } = {}) {
  const $ = cheerio.load(html);
  const itemsByLink = new Map();
  const selector = [
    `a[href^="${basePath}"]`,
    `a[href^="https://www.anthropic.com${basePath}"]`
  ].join(', ');

  $(selector).each((_, element) => {
    const anchor = $(element);
    const rawHref = anchor.attr('href') ?? '';
    const url = new URL(rawHref, 'https://www.anthropic.com');
    if (url.pathname === indexPath || url.pathname.startsWith(`${basePath}team/`)) {
      return;
    }

    const title = firstText(anchor, [
      '[class*="title" i]',
      'h1',
      'h2',
      'h3'
    ]);
    const publishedText = firstText(anchor, ['time']);
    const publishedAt = publishedText ? dateToIso(publishedText) : null;
    const category = firstText(anchor, [
      '[class*="subject" i]',
      '[class*="meta" i] span',
      '.caption'
    ]);
    const summary = firstText(anchor, ['p']);

    if (!title || title === 'Research') {
      return;
    }

    const item = {
      title,
      link: url.toString(),
      id: url.toString(),
      publishedAt,
      author: 'Anthropic',
      summary,
      category
    };
    const previous = itemsByLink.get(item.link);
    if (!previous || scoreResearchItem(item) > scoreResearchItem(previous)) {
      itemsByLink.set(item.link, item);
    }
  });

  return [...itemsByLink.values()]
    .sort((a, b) => String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? '')))
    .slice(0, maxItems);
}

function failedSource(source, error, now) {
  return {
    ...source,
    status: 'error',
    fetchedAt: now ?? new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error),
    items: []
  };
}

async function mapConcurrent(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await worker(items[current], current);
    }
  });

  await Promise.all(workers);
  return results;
}

function firstMatch(value, pattern) {
  return value.match(pattern)?.[1] ?? null;
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function firstText(scope, selectors) {
  for (const selector of selectors) {
    const value = scope.find(selector).first().text().replace(/\s+/g, ' ').trim();
    if (value) {
      return value;
    }
  }
  return '';
}

function dateToIso(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function scoreResearchItem(item) {
  return [item.title, item.publishedAt, item.category, item.summary]
    .filter(Boolean)
    .join('')
    .length;
}

function cleanCategories(categories) {
  return categories.map((category) =>
    String(category)
      .replace(/^<!\[CDATA\['?/, '')
      .replace(/'?\]\]>$/, '')
      .replace(/&amp;/g, '&')
      .trim()
  ).filter(Boolean);
}

function normalizeTwitterLink(link, handle) {
  if (!link) {
    return handle ? `https://x.com/${handle}` : '';
  }

  try {
    const url = new URL(link);
    if (url.hostname.includes('nitter.net')) {
      url.hostname = 'x.com';
    }
    return url.toString();
  } catch {
    return link;
  }
}

function stripHtml(value) {
  return cheerio.load(String(value)).text();
}

function jsonLdUrl(value) {
  try {
    const parsed = JSON.parse(value);
    const graph = Array.isArray(parsed['@graph']) ? parsed['@graph'] : [];
    return graph.find((entry) => entry?.['@type'] === 'WebPage')?.url ?? null;
  } catch {
    return null;
  }
}
