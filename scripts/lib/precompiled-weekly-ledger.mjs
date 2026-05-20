import { slugify, stripHtml, summarizeText } from './text-utils.mjs';

const ASSET_FAMILIES = [
  ['youtube', 'YouTube'],
  ['googleNews', 'Google News'],
  ['huggingFacePapers', 'Hugging Face Daily Papers'],
  ['googleResearch', 'Google Research'],
  ['anthropicResearch', 'Anthropic Research'],
  ['anthropicNews', 'Anthropic News'],
  ['vercelAnnouncements', 'Vercel'],
  ['githubOrganizations', 'GitHub'],
  ['metaResearch', 'Meta Research'],
  ['publicationFeeds', 'Publication Feeds'],
  ['xaiResearch', 'xAI Research'],
  ['twitterFeeds', 'X/Twitter']
];

export function buildWeeklyLedgerFromPrecompiled({
  generatedAt = new Date().toISOString(),
  startDate,
  endDate,
  assets,
  maxItems = 120
}) {
  const window = normalizeWindow(startDate, endDate);
  const seen = new Set();
  const sourceRecords = [];
  const items = [];

  for (const [assetKey, familyLabel] of ASSET_FAMILIES) {
    const sources = sourcesForAsset(assets[assetKey]);
    for (const source of sources) {
      sourceRecords.push(source);
      if (source.status && source.status !== 'ok') continue;
      for (const item of source.items ?? []) {
        const publishedAt = item.publishedAt ?? item.updatedAt ?? item.submittedAt ?? null;
        if (!isWithinWindow(publishedAt, window)) continue;
        const url = item.link ?? item.url ?? item.projectPage ?? item.githubRepo ?? '';
        if (!url || seen.has(url)) continue;
        seen.add(url);
        items.push(toSummaryItem({ item, source, assetKey, familyLabel, publishedAt, generatedAt }));
      }
    }
  }

  const sortedItems = items
    .sort((left, right) => String(right.publishedAt ?? '').localeCompare(String(left.publishedAt ?? '')))
    .slice(0, maxItems);

  return {
    generatedAt,
    sourceCount: sourceRecords.length,
    itemCount: sortedItems.length,
    window: {
      startDate: window.startDate,
      endDate: window.endDate
    },
    items: sortedItems
  };
}

function sourcesForAsset(asset) {
  if (!asset) return [];
  if (Array.isArray(asset.sources)) return asset.sources;
  if (asset.source) return [asset.source];
  if (asset.aiResearch || asset.sources) {
    return [
      ...(asset.sources ?? []),
      ...(asset.aiResearch ? [asset.aiResearch] : [])
    ];
  }
  return [];
}

function toSummaryItem({ item, source, assetKey, familyLabel, publishedAt, generatedAt }) {
  const sourceName = source.title ?? source.topic ?? source.handle ?? familyLabel;
  const title = item.title || item.id || sourceName;
  const text = stripHtml(item.transcriptSummary ?? item.transcript?.text ?? item.summary ?? item.description ?? title);
  const tags = [
    'ai',
    source.category,
    source.topic,
    assetKey,
    ...(item.categories ?? []),
    ...(item.keywords ?? [])
  ].filter(Boolean).map((tag) => String(tag).toLowerCase());

  return {
    id: `${slugify(assetKey)}-${slugify(source.id ?? sourceName)}-${slugify(item.id ?? item.link ?? title)}`,
    sourceId: source.id ?? slugify(sourceName),
    sourceName,
    kind: assetKey,
    title,
    url: item.link ?? item.url ?? item.projectPage ?? item.githubRepo ?? source.sourceUrl,
    publishedAt,
    fetchedAt: generatedAt,
    summary: summarizeText(text, 2),
    transcript: item.transcript,
    tags: [...new Set(tags)].slice(0, 10),
    status: 'ok'
  };
}

function normalizeWindow(startDate, endDate) {
  if (!startDate || !endDate) {
    throw new Error('startDate and endDate are required.');
  }
  return {
    startDate,
    endDate,
    start: new Date(`${startDate}T00:00:00.000Z`),
    end: new Date(`${endDate}T23:59:59.999Z`)
  };
}

function isWithinWindow(value, window) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date >= window.start && date <= window.end;
}
