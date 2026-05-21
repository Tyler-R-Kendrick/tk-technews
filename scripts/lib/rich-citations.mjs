const VIDEO_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com']);
const TWEET_HOSTS = new Set(['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com']);

/**
 * Builds normalized preview metadata for rendering a citation as a rich link card.
 */
export function citationPreview(citation) {
  const href = citation?.url ?? citation?.href ?? '';
  const title = cleanText(citation?.title) || href;
  const source = cleanText(citation?.sourceName ?? citation?.source) || hostLabel(href);
  const summary = cleanText(citation?.summary ?? citation?.snippet ?? citation?.description);
  const kind = isTweetUrl(href) ? 'tweet' : isVideoUrl(href) ? 'video' : 'source';
  const social = kind === 'tweet' ? extractSocialPostParts({ title, summary }) : null;
  const snippet = trimText(social?.text || summary || (kind === 'tweet' ? title : ''), 220);
  const previewTitle = socialTitle(title, social);

  return {
    kind,
    label: kind === 'tweet' ? socialLabel(social) : kind === 'video' ? 'Video' : 'Source',
    href,
    title: trimText(previewTitle, 140),
    source,
    snippet,
    host: hostLabel(href),
    thumbnailUrl: youtubeThumbnailUrl(href),
    social
  };
}

export function extractSocialPostParts({ title = '', summary = '' } = {}) {
  const titleText = cleanText(title);
  const rawSummaryText = cleanText(summary || titleText);
  const summaryText = cleanTweetText(rawSummaryText);
  const retweet = titleText.match(/^RT\s+([^:]+):\s*(.*)$/i) ?? summaryText.match(/^RT\s+@?([A-Za-z0-9_.-]{2,40}):?\s+(.+)$/i);
  const originalAuthor = retweet ? cleanText(retweet[1]) : null;
  const withoutRetweet = retweet
    ? cleanTweetText(removeRetweetPrefix(rawSummaryText, originalAuthor))
    : summaryText;
  const quotedUrlMatch = firstUrlMatch(withoutRetweet);
  const quotedUrl = quotedUrlMatch?.url ?? null;
  const [mainText, quotedTail = ''] = quotedUrl
    ? withoutRetweet.split(quotedUrlMatch.splitToken, 2)
    : [withoutRetweet, ''];
  const postText = cleanTweetText(mainText || withoutRetweet).replace(/\bRead more(?: here)?\s*:?\s*$/i, '').trim();
  const quotedTitle = cleanQuotedTitle(quotedTail);

  return {
    kind: originalAuthor ? 'retweet' : quotedUrl ? 'quote' : 'post',
    originalAuthor,
    text: trimText(postText, 280),
    quotedUrl: quotedUrl ?? null,
    quotedTitle: quotedTitle ? trimText(quotedTitle, 180) : null
  };
}

/**
 * Removes duplicate source-like records using canonical URLs first, then stable source text.
 */
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

/**
 * Returns true only for X/Twitter status URLs that can be treated as quoted posts.
 */
export function isTweetUrl(value) {
  const parsed = parseUrl(value);
  return Boolean(parsed && TWEET_HOSTS.has(parsed.hostname.toLowerCase()) && /\/status\/\d+/i.test(parsed.pathname));
}

/**
 * Returns true for direct video files and concrete YouTube video, Shorts, or embed URLs.
 */
export function isVideoUrl(value) {
  const parsed = parseUrl(value);
  if (!parsed) return false;
  const host = parsed.hostname.toLowerCase();
  if (/\.(mp4|webm|mov)$/i.test(parsed.pathname)) return true;
  if (!VIDEO_HOSTS.has(host)) return false;
  return Boolean(youtubeId(value));
}

/**
 * Produces a stable URL key for deduplicating citations across tracking params and URL aliases.
 */
export function canonicalUrlKey(value) {
  const parsed = parseUrl(value);
  if (!parsed) return cleanText(value).toLowerCase();

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const path = parsed.pathname.replace(/\/+$/, '');
  if ((host === 'x.com' || host === 'twitter.com') && /\/status\/\d+/i.test(path)) {
    const match = path.match(/\/([^/]+)\/status\/(\d+)/i);
    return match ? `x.com/${match[1].toLowerCase()}/status/${match[2]}` : `${host}${path.toLowerCase()}`;
  }
  if (host === 'youtu.be' || isYoutubeHost(host)) {
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
  if (isYoutubeHost(host)) {
    if (pathSegments[0] === 'shorts') return pathSegments[1] || null;
    if (pathSegments[0] === 'embed') return pathSegments[1] || null;
    return parsed.searchParams.get('v');
  }
  return null;
}

function isYoutubeHost(host) {
  return host === 'youtube.com' || host.endsWith('.youtube.com');
}

function hostLabel(value) {
  const parsed = parseUrl(value);
  return parsed ? parsed.hostname.replace(/^www\./, '') : 'Source';
}

function socialLabel(social) {
  if (social?.kind === 'retweet') return 'Retweet';
  if (social?.kind === 'quote') return 'Quote';
  return 'X post';
}

function socialTitle(title, social) {
  if (social?.kind === 'retweet' && social.originalAuthor) {
    return `${social.originalAuthor}: ${social.text || cleanTweetText(title).replace(/^RT\s+/i, '')}`;
  }
  return title;
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

function cleanTweetText(value) {
  return cleanText(value)
    .replace(/([!?])(\.)/g, '$1 $2')
    .replace(/([a-z0-9)]\.)([A-Z@#])/g, '$1 $2')
    .replace(/([!?])([A-Za-z@#])/g, '$1 $2')
    .replace(/([a-z0-9)])(@|#)/g, '$1 $2')
    .replace(/\s+([.!?,:;])/g, '$1')
    .trim();
}

function firstUrlMatch(value) {
  const match = String(value ?? '').match(/https?:\/\/\S+/i);
  if (!match) return null;
  const candidate = match[0].replace(/[),.;]+$/g, '');
  const sourceLabelBoundary = candidate.match(/^(https?:\/\/.*?)(?=[A-Z][A-Za-z0-9 ._-]{1,80}:)/);
  const splitToken = sourceLabelBoundary?.[1] ?? candidate;
  const url = cleanQuotedUrl(splitToken);
  return { url, splitToken };
}

function cleanQuotedUrl(value) {
  const parsed = parseUrl(value);
  if (parsed && isTweetUrl(parsed.href)) {
    return `${parsed.origin}${parsed.pathname}`;
  }
  return value.replace(/[?&]$/g, '');
}

function cleanQuotedTitle(value) {
  const title = value ? cleanTweetText(value).replace(/^[:\s-]+/, '') : '';
  return /^[?&]?[A-Za-z0-9_]+=/.test(title) ? '' : title;
}

function removeRetweetPrefix(value, originalAuthor) {
  const authorPattern = String(originalAuthor ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s*');
  if (!authorPattern) return value;
  return String(value ?? '').replace(new RegExp(`^RT\\s+${authorPattern}:?\\s*`, 'i'), '');
}

function trimText(value, maxLength) {
  const clean = cleanText(value);
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 3).trimEnd()}...` : clean;
}
