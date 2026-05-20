import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFirecrawlScrapeRequest, hasFirecrawlKey } from './firecrawl-client.mjs';

test('builds a conservative Firecrawl scrape request for article extraction', () => {
  const request = buildFirecrawlScrapeRequest('https://example.com/news');

  assert.deepEqual(request, {
    url: 'https://example.com/news',
    formats: ['markdown'],
    onlyMainContent: true,
    waitFor: 1000,
    timeout: 30000
  });
});

test('rejects relative URLs before calling Firecrawl', () => {
  assert.throws(() => buildFirecrawlScrapeRequest('/news'), /absolute http\(s\) URL/);
});

test('detects Firecrawl API key presence from the environment', () => {
  assert.equal(hasFirecrawlKey({}), false);
  assert.equal(hasFirecrawlKey({ FIRECRAWL_API_KEY: 'fc-test' }), true);
});
