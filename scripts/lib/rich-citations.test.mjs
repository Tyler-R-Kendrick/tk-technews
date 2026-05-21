import test from 'node:test';
import assert from 'node:assert/strict';
import {
  citationPreview,
  canonicalUrlKey,
  dedupeCitationLikeItems,
  extractSocialPostParts,
  isTweetUrl,
  isVideoUrl
} from './rich-citations.mjs';

test('builds an inline tweet preview with source snippet and clickable source URL', () => {
  const preview = citationPreview({
    title: 'Cloudflare Tunnels meet Claude Managed Agents',
    url: 'https://x.com/cloudflare/status/2057000000000000000',
    sourceName: '@cloudflare',
    summary: 'Cloudflare Tunnels and Claude Managed Agents can connect private databases, internal APIs, and knowledge bases.'
  });

  assert.equal(preview.kind, 'tweet');
  assert.equal(preview.href, 'https://x.com/cloudflare/status/2057000000000000000');
  assert.equal(preview.label, 'X post');
  assert.equal(preview.source, '@cloudflare');
  assert.match(preview.snippet, /Claude Managed Agents/);
  assert.equal(isTweetUrl(preview.href), true);
});

test('builds a video preview with YouTube thumbnail metadata', () => {
  const preview = citationPreview({
    title: 'Supercharge your AI coding workflow with Chrome DevTools for agents',
    url: 'https://www.youtube.com/watch?v=PC9YBeURWk0',
    source: 'Google for Developers'
  });

  assert.equal(preview.kind, 'video');
  assert.equal(preview.label, 'Video');
  assert.equal(preview.thumbnailUrl, 'https://i.ytimg.com/vi/PC9YBeURWk0/hqdefault.jpg');
  assert.equal(isVideoUrl(preview.href), true);
});

test('dedupes citation-like items by canonical URL and repeated source text', () => {
  const deduped = dedupeCitationLikeItems([
    {
      title: 'Gemini 3.5 Flash is generally available for GitHub Copilot',
      url: 'https://github.blog/changelog/gemini-flash?utm_source=x',
      summary: 'Gemini 3.5 Flash is generally available for GitHub Copilot and supports fast agentic coding.'
    },
    {
      title: 'Gemini 3.5 Flash is generally available for GitHub Copilot',
      url: 'https://github.blog/changelog/gemini-flash',
      summary: 'Gemini 3.5 Flash is generally available for GitHub Copilot and supports fast agentic coding.'
    },
    {
      title: 'GitHub Copilot remote control is generally available',
      url: 'https://github.blog/changelog/copilot-remote-control',
      summary: 'Remote control for GitHub Copilot CLI sessions is generally available.'
    }
  ]);

  assert.deepEqual(deduped.map((item) => item.url), [
    'https://github.blog/changelog/gemini-flash?utm_source=x',
    'https://github.blog/changelog/copilot-remote-control'
  ]);
});

test('builds a source preview for a regular web article (non-tweet, non-video)', () => {
  const preview = citationPreview({
    title: 'OpenAI to confidentially file for IPO as soon as Friday: Source - CNBC',
    url: 'https://www.cnbc.com/2026/05/20/openai-ipo.html',
    sourceName: 'CNBC',
    summary: 'OpenAI is preparing to file for an IPO as soon as this Friday according to sources familiar with the matter.'
  });

  assert.equal(preview.kind, 'source');
  assert.equal(preview.label, 'Source');
  assert.equal(preview.href, 'https://www.cnbc.com/2026/05/20/openai-ipo.html');
  assert.equal(preview.source, 'CNBC');
  assert.equal(preview.host, 'cnbc.com');
  assert.equal(preview.thumbnailUrl, null);
  assert.match(preview.snippet, /OpenAI is preparing/);
});

test('builds a tweet preview for a twitter.com URL as well as x.com', () => {
  const preview = citationPreview({
    title: 'Karpathy: Joining Anthropic',
    url: 'https://twitter.com/karpathy/status/2057000000000000000',
    sourceName: '@karpathy',
    summary: 'Excited to announce I am joining Anthropic to work on AI safety and research.'
  });

  assert.equal(preview.kind, 'tweet');
  assert.equal(preview.label, 'X post');
  assert.equal(isTweetUrl(preview.href), true);
});

test('retweet previews preserve original author and clean text without RT glue', () => {
  const preview = citationPreview({
    title: 'RT elvis: Very interesting results from this NanoGPT-Bench eval. There is so much talk about self-improving agents.',
    summary: 'RT elvisVery interesting results from this NanoGPT-Bench eval.There is so much talk about self-improving agents.Read more here: https://www.intology.ai/blog/nanogpt-benchIntology: Can coding agents do research?',
    url: 'https://x.com/omarsar0/status/2057067617156800573',
    sourceName: '@omarsar0'
  });

  assert.equal(preview.kind, 'tweet');
  assert.equal(preview.label, 'Retweet');
  assert.equal(preview.social.kind, 'retweet');
  assert.equal(preview.social.originalAuthor, 'elvis');
  assert.match(preview.title, /^elvis: Very interesting results/);
  assert.doesNotMatch(preview.title, /^RT\b/i);
  assert.match(preview.social.text, /^Very interesting results/);
  assert.doesNotMatch(preview.snippet, /^RT\b/i);
  assert.doesNotMatch(preview.snippet, /elvisVery/);
});

test('quote previews expose quoted link metadata separately from tweet text', () => {
  const parts = extractSocialPostParts({
    title: 'RT elvis: Very interesting results from this NanoGPT-Bench eval.',
    summary: 'RT elvisVery interesting results from this NanoGPT-Bench eval.Read more here: https://www.intology.ai/blog/nanogpt-benchIntology: Can coding agents do research?We release NanoGPT-Bench, an internal eval we’ve used to test agents on an AI R&D problem.'
  });

  assert.equal(parts.kind, 'retweet');
  assert.equal(parts.originalAuthor, 'elvis');
  assert.equal(parts.quotedUrl, 'https://www.intology.ai/blog/nanogpt-bench');
  assert.match(parts.quotedTitle, /Intology: Can coding agents do research/);
  assert.doesNotMatch(parts.text, /Read more here|https?:\/\//i);
});

test('summary retweet fallback captures only the author token', () => {
  const parts = extractSocialPostParts({
    title: '',
    summary: 'RT elvis Very interesting results from this NanoGPT-Bench eval.'
  });

  assert.equal(parts.kind, 'retweet');
  assert.equal(parts.originalAuthor, 'elvis');
  assert.match(parts.text, /^Very interesting results/);
});

test('isTweetUrl returns false for x.com URLs without a /status/ path', () => {
  assert.equal(isTweetUrl('https://x.com/cloudflare'), false);
  assert.equal(isTweetUrl('https://x.com/'), false);
  assert.equal(isTweetUrl('https://x.com/settings/notifications'), false);
  assert.equal(isTweetUrl('https://github.com/cloudflare'), false);
});

test('isTweetUrl returns true for www.x.com and www.twitter.com status URLs', () => {
  assert.equal(isTweetUrl('https://www.x.com/user/status/12345678901234567'), true);
  assert.equal(isTweetUrl('https://www.twitter.com/openai/status/12345678901234567'), true);
});

test('isVideoUrl returns true for YouTube watch URLs, youtu.be, and YouTube Shorts', () => {
  assert.equal(isVideoUrl('https://www.youtube.com/watch?v=PC9YBeURWk0'), true);
  assert.equal(isVideoUrl('https://youtu.be/PC9YBeURWk0'), true);
  assert.equal(isVideoUrl('https://m.youtube.com/watch?v=PC9YBeURWk0'), true);
  assert.equal(isVideoUrl('https://www.youtube.com/shorts/PC9YBeURWk0'), true);
});

test('isVideoUrl returns true for direct video file URLs and false for non-video URLs', () => {
  assert.equal(isVideoUrl('https://example.com/video.mp4'), true);
  assert.equal(isVideoUrl('https://example.com/clip.webm'), true);
  assert.equal(isVideoUrl('https://example.com/video.mov'), true);
  assert.equal(isVideoUrl('https://www.youtube.com/@GoogleDevelopers'), false);
  assert.equal(isVideoUrl('https://www.youtube.com/playlist?list=PL123'), false);
  assert.equal(isVideoUrl('https://example.com/article'), false);
  assert.equal(isVideoUrl('https://news.google.com/rss/articles/abc123'), false);
});

test('citationPreview truncates long titles to 140 chars and snippets to 220 chars', () => {
  const longTitle = 'A '.repeat(100).trim(); // 199 chars
  const longSummary = 'Word '.repeat(60).trim(); // 299 chars

  const preview = citationPreview({
    title: longTitle,
    url: 'https://example.com/article',
    sourceName: 'Example',
    summary: longSummary
  });

  assert.ok(preview.title.length <= 140, `title length ${preview.title.length} exceeds 140`);
  assert.ok(preview.snippet.length <= 220, `snippet length ${preview.snippet.length} exceeds 220`);
  assert.ok(preview.title.endsWith('...'));
  assert.ok(preview.snippet.endsWith('...'));
});

test('citationPreview falls back gracefully with null or undefined inputs', () => {
  const preview = citationPreview(null);
  assert.equal(preview.kind, 'source');
  assert.equal(preview.href, '');
  assert.equal(preview.host, 'Source');
  assert.equal(preview.thumbnailUrl, null);

  const preview2 = citationPreview(undefined);
  assert.equal(preview2.kind, 'source');
  assert.equal(preview2.href, '');
});

test('citationPreview uses href field as fallback when url is absent', () => {
  const preview = citationPreview({
    href: 'https://x.com/vercel/status/2057000000000000001',
    title: 'Vercel AI Gateway',
    source: 'Vercel'
  });

  assert.equal(preview.kind, 'tweet');
  assert.equal(preview.href, 'https://x.com/vercel/status/2057000000000000001');
});

test('citationPreview for YouTube includes thumbnailUrl derived from video ID', () => {
  const preview = citationPreview({
    title: 'Designing Better Data Models with an AI Coding Agent',
    url: 'https://www.youtube.com/watch?v=F2RKDp65WUw',
    source: 'Microsoft Reactor'
  });

  assert.equal(preview.kind, 'video');
  assert.equal(preview.thumbnailUrl, 'https://i.ytimg.com/vi/F2RKDp65WUw/hqdefault.jpg');
  assert.equal(preview.host, 'youtube.com');
});

test('citationPreview for youtu.be short URLs extracts thumbnail from video ID', () => {
  const preview = citationPreview({
    title: 'Short video clip',
    url: 'https://youtu.be/Zl4tyHVQLkc',
    sourceName: 'YouTube'
  });

  assert.equal(preview.kind, 'video');
  assert.equal(preview.thumbnailUrl, 'https://i.ytimg.com/vi/Zl4tyHVQLkc/hqdefault.jpg');
});

test('citationPreview uses snippet field when summary is absent', () => {
  const preview = citationPreview({
    title: 'Some article',
    url: 'https://example.com/article',
    sourceName: 'Example',
    snippet: 'This is the snippet text used for the preview.'
  });

  assert.equal(preview.snippet, 'This is the snippet text used for the preview.');
});

test('citationPreview uses description field when summary and snippet are absent', () => {
  const preview = citationPreview({
    title: 'Some article',
    url: 'https://example.com/article',
    sourceName: 'Example',
    description: 'Description text used for the preview.'
  });

  assert.equal(preview.snippet, 'Description text used for the preview.');
});

test('canonicalUrlKey strips www prefix and trailing slashes from URLs', () => {
  const key1 = canonicalUrlKey('https://www.example.com/path/');
  const key2 = canonicalUrlKey('https://example.com/path');
  assert.equal(key1, key2);
});

test('canonicalUrlKey strips UTM and tracking params from URLs', () => {
  const key1 = canonicalUrlKey('https://example.com/article?utm_source=x&utm_medium=social');
  const key2 = canonicalUrlKey('https://example.com/article');
  assert.equal(key1, key2);

  const key3 = canonicalUrlKey('https://example.com/article?fbclid=abc123');
  assert.equal(key3, key2);
});

test('canonicalUrlKey normalizes x.com and twitter.com status URLs to the same key', () => {
  const xKey = canonicalUrlKey('https://x.com/cloudflare/status/2057091308733210902');
  const twitterKey = canonicalUrlKey('https://twitter.com/cloudflare/status/2057091308733210902');
  assert.equal(xKey, twitterKey);
  assert.equal(xKey, 'x.com/cloudflare/status/2057091308733210902');
});

test('canonicalUrlKey normalizes youtu.be short URLs to youtube.com/watch?v= format', () => {
  const shortKey = canonicalUrlKey('https://youtu.be/PC9YBeURWk0');
  const longKey = canonicalUrlKey('https://www.youtube.com/watch?v=PC9YBeURWk0');
  assert.equal(shortKey, longKey);
  assert.equal(shortKey, 'youtube.com/watch?v=PC9YBeURWk0');
});

test('canonicalUrlKey normalizes YouTube Shorts URLs to youtube.com/watch?v= format', () => {
  const shortsKey = canonicalUrlKey('https://www.youtube.com/shorts/PC9YBeURWk0/');
  const youtuBeShortsKey = canonicalUrlKey('https://youtu.be/shorts/PC9YBeURWk0');
  const watchKey = canonicalUrlKey('https://www.youtube.com/watch?v=PC9YBeURWk0');
  assert.equal(shortsKey, watchKey);
  assert.equal(youtuBeShortsKey, watchKey);
});

test('YouTube handling requires a real host boundary', () => {
  const fakeShortsUrl = 'https://notyoutube.com/shorts/PC9YBeURWk0';
  assert.equal(canonicalUrlKey(fakeShortsUrl), 'notyoutube.com/shorts/pc9ybeurwk0');
  assert.equal(isVideoUrl(fakeShortsUrl), false);

  const preview = citationPreview({ url: fakeShortsUrl, title: 'Fake shorts page' });
  assert.equal(preview.kind, 'source');
  assert.equal(preview.thumbnailUrl, null);
});

test('canonicalUrlKey preserves non-tracking query params while stripping oc= Google News param', () => {
  const withOc = canonicalUrlKey('https://news.google.com/rss/articles/abc123?oc=5');
  const withoutOc = canonicalUrlKey('https://news.google.com/rss/articles/abc123');
  assert.equal(withOc, withoutOc);
});

test('canonicalUrlKey returns lowercased key for non-URL strings', () => {
  const key = canonicalUrlKey('Some plain text string');
  assert.equal(key, 'some plain text string');
});

test('canonicalUrlKey returns empty string for null or undefined', () => {
  assert.equal(canonicalUrlKey(null), '');
  assert.equal(canonicalUrlKey(undefined), '');
  assert.equal(canonicalUrlKey(''), '');
});

test('dedupeCitationLikeItems returns empty array for null or undefined input', () => {
  assert.deepEqual(dedupeCitationLikeItems(null), []);
  assert.deepEqual(dedupeCitationLikeItems(undefined), []);
  assert.deepEqual(dedupeCitationLikeItems([]), []);
});

test('dedupeCitationLikeItems keeps items with short text that cannot form a content key', () => {
  const items = [
    { title: 'Short', url: 'https://example.com/a', summary: 'Brief.' },
    { title: 'Short', url: 'https://example.com/b', summary: 'Brief.' }
  ];
  const deduped = dedupeCitationLikeItems(items);
  assert.equal(deduped.length, 2);
});

test('dedupeCitationLikeItems uses link and href as fallbacks for URL deduplication', () => {
  const deduped = dedupeCitationLikeItems([
    { title: 'A1', link: 'https://example.com/page', summary: 'First item has distinct wording so content-key dedupe will not trigger.' },
    { title: 'A2', href: 'https://example.com/page', summary: 'Second item also has different wording and should dedupe only by URL fallback.' }
  ]);
  assert.equal(deduped.length, 1);
});
