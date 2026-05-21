const VIDEO_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com']);
const TWEET_HOSTS = new Set(['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com']);

export function citationPreview(citation) {
  const href = citation?.url ?? citation?.href ?? '';
  const title = cleanText(citation?.title) || href;
  const source = cleanText(citation?.sourceName ?? citation?.source) || hostLabel(href);
  const summary = cleanText(citation?.summary ?? citation?.snippet ?? citation?.description);
  const kind = isTweetUrl(href) ? 'tweet' : isVideoUrl(href) ? 'video' : 'source';
  const snippet = trimText(summary || (kind === 'tweet' ? title : ''), 220);

  return {
    kind,
    label: kind === 'tweet' ? 'X post' : kind === 'video' ? 'Video' : 'Source',
    href,
    title: trimText(title, 140),
    source,
    snippet,
    host: hostLabel(href),
    thumbnailUrl: youtubeThumbnailUrl(href)
  };
}

export function dedupeCitationLikeItems(items) {
  const seenUrls = new Set();
  const seenText = new Set();
  const deduped = [];

  for (const item of items ?? []) {
    const urlKey = canonicalUrlKey(item?.url ?? item?.link ?? item?.href);
    const textKey = contentKey(`${item?.title ?? ''} ${item?.summary ?? ''} ${item?.sourceText ?? ''}`);
    if ((urlKey && seenUrls.has(urlKey)) || (textKey && seenText.has(textKey))) continue;
    if (urlKey) seenUrls.add(urlKey);
    if (textKey) seenText.add(textKey);
    deduped.push(item);
  }

  return deduped;
}

export function isTweetUrl(value) {
  const parsed = parseUrl(value);
  return Boolean(parsed && TWEET_HOSTS.has(parsed.hostname.toLowerCase()) && /\/status\/\d+/i.test(parsed.pathname));
}

export function isVideoUrl(value) {
  const parsed = parseUrl(value);
  if (!parsed) return false;
  const host = parsed.hostname.toLowerCase();
  if (/\.(mp4|webm|mov)$/i.test(parsed.pathname)) return true;
  if (!VIDEO_HOSTS.has(host)) return false;
  return Boolean(youtubeId(value));
}

export function canonicalUrlKey(value) {
  const parsed = parseUrl(value);
  if (!parsed) return cleanText(value).toLowerCase();

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const path = parsed.pathname.replace(/\/+$/, '');
  if ((host === 'x.com' || host === 'twitter.com') && /\/status\/\d+/i.test(path)) {
    const match = path.match(/\/([^/]+)\/status\/(\d+)/i);
    return match ? `x.com/${match[1].toLowerCase()}/status/${match[2]}` : `${host}${path.toLowerCase()}`;
  }
  if (host === 'youtu.be' || host.endsWith('youtube.com')) {
    const id = youtubeId(value);
    if (id) return `youtube.com/watch?v=${id}`;
  }
  return `${host}${path.toLowerCase()}${canonicalSearch(parsed)}`;
}

function canonicalSearch(parsed) {
  const ignored = /^(utm_|fbclid$|gclid$|oc$)/i;
  const params = [...parsed.searchParams.entries()]
    .filter(([key]) => !ignored.test(key))
    .sort(([left], [right]) => left.localeCompare(right));
  if (params.length === 0) return '';
  const search = new URLSearchParams(params);
  return `?${search.toString()}`;
}

function youtubeThumbnailUrl(value) {
  const id = youtubeId(value);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}

function youtubeId(value) {
  const parsed = parseUrl(value);
  if (!parsed) return null;
  const host = parsed.hostname.toLowerCase();
  const pathSegments = parsed.pathname.split('/').filter(Boolean);
  if (host === 'youtu.be') {
    if (pathSegments[0] === 'shorts') return pathSegments[1] || null;
    return pathSegments.length === 1 ? pathSegments[0] : null;
  }
  if (host.endsWith('youtube.com')) {
    if (pathSegments[0] === 'shorts') return pathSegments[1] || null;
    if (pathSegments[0] === 'embed') return pathSegments[1] || null;
    return parsed.searchParams.get('v');
  }
  return null;
}

function hostLabel(value) {
  const parsed = parseUrl(value);
  return parsed ? parsed.hostname.replace(/^www\./, '') : 'Source';
}

function contentKey(value) {
  const words = cleanText(value)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 2);
  if (words.length < 8) return '';
  return words.slice(0, 42).join(' ');
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function trimText(value, maxLength) {
  const clean = cleanText(value);
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 3).trimEnd()}...` : clean;
}
