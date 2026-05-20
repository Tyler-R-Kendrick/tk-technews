const DEFAULT_FORMATS = ['markdown'];

export function hasFirecrawlKey(env = process.env) {
  return Boolean(env.FIRECRAWL_API_KEY);
}

export function buildFirecrawlScrapeRequest(url, options = {}) {
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error(`Firecrawl requires an absolute http(s) URL. Received: ${url}`);
  }

  return {
    url,
    formats: options.formats ?? DEFAULT_FORMATS,
    onlyMainContent: options.onlyMainContent ?? true,
    waitFor: options.waitFor ?? 1000,
    timeout: options.timeout ?? 30000
  };
}

export async function scrapeWithFirecrawl(url, options = {}) {
  const apiKey = options.apiKey ?? process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error('FIRECRAWL_API_KEY is required for Firecrawl scraping.');
  }

  const endpoint = options.endpoint ?? 'https://api.firecrawl.dev/v2/scrape';
  const body = buildFirecrawlScrapeRequest(url, options);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    const detail = payload.error || payload.message || `HTTP ${response.status}`;
    throw new Error(`Firecrawl scrape failed for ${url}: ${detail}`);
  }

  const data = payload.data ?? payload;
  return {
    title: data.metadata?.title || data.title || url,
    url: data.metadata?.sourceURL || data.url || url,
    markdown: data.markdown || '',
    metadata: data.metadata ?? {},
    raw: payload
  };
}
