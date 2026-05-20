import test from 'node:test';
import assert from 'node:assert/strict';
import {
  citationPreview,
  dedupeCitationLikeItems,
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
