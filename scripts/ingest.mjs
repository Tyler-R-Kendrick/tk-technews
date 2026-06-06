import fs from 'node:fs/promises';
import path from 'node:path';
import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import { YoutubeTranscript } from 'youtube-transcript';
import { slugify, stripHtml, summarizeText } from './lib/text-utils.mjs';
import { hasFirecrawlKey, scrapeWithFirecrawl } from './lib/firecrawl-client.mjs';

const root = process.cwd();
const sourcesPath = path.join(root, 'data', 'sources.json');
const rawDir = path.join(root, 'data', 'raw');
const summariesDir = path.join(root, 'data', 'summaries');
const parser = new Parser();

await fs.mkdir(rawDir, { recursive: true });
await fs.mkdir(summariesDir, { recursive: true });

const sources = JSON.parse(await fs.readFile(sourcesPath, 'utf8'));
const entries = [
  ...(sources.rss ?? []).map((source) => ({ ...source, kind: 'rss' })),
  ...(sources.web ?? []).map((source) => ({ ...source, kind: 'web' })),
  ...(sources.youtube ?? []).map((source) => ({ ...source, kind: 'youtube' }))
].filter((source) => !source.disabled);

const summaries = [];
const sourceErrors = [];

for (const source of entries) {
  try {
    if (source.kind === 'rss') {
      summaries.push(...await ingestRss(source));
    } else if (source.kind === 'web') {
      summaries.push(await ingestWeb(source));
    } else if (source.kind === 'youtube') {
      summaries.push(await ingestYoutube(source));
    }
  } catch (error) {
    sourceErrors.push({
      sourceId: source.id,
      sourceName: source.name,
      kind: source.kind,
      url: source.url,
      fetchedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      tags: source.topicTags ?? [],
      status: 'error'
    });
  }
}

const output = {
  generatedAt: new Date().toISOString(),
  sourceCount: entries.length,
  itemCount: summaries.length,
  sourceErrorCount: sourceErrors.length,
  sourceErrors,
  items: summaries
};

await fs.writeFile(path.join(summariesDir, 'latest.json'), `${JSON.stringify(output, null, 2)}\n`);
const errorSuffix = sourceErrors.length > 0 ? ` (${sourceErrors.length} source errors omitted from summaries)` : '';
console.log(`Wrote ${summaries.length} summaries to data/summaries/latest.json${errorSuffix}`);

async function ingestRss(source) {
  const feed = await parser.parseURL(source.url);
  const items = feed.items.slice(0, source.limit ?? 5);
  await writeRaw(source.id, feed);

  return items.map((item, index) => {
    const text = stripHtml(item.contentSnippet || item.content || item.summary || item.title || '');
    return {
      id: `${source.id}-${slugify(item.guid || item.link || item.title || index)}`,
      sourceId: source.id,
      sourceName: source.name,
      kind: source.kind,
      title: item.title || source.name,
      url: item.link || source.url,
      publishedAt: item.isoDate || item.pubDate || null,
      fetchedAt: new Date().toISOString(),
      summary: summarizeText(text),
      tags: source.topicTags ?? [],
      status: 'ok'
    };
  });
}

async function ingestWeb(source) {
  if (source.scraper === 'firecrawl' && hasFirecrawlKey()) {
    return ingestWebWithFirecrawl(source);
  }

  const response = await fetch(source.url, {
    headers: {
      'user-agent': 'tk-technews research bot; contact: local-development'
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while fetching ${source.url}`);
  }

  const html = await response.text();
  await writeRaw(source.id, { url: source.url, html });

  const $ = cheerio.load(html);
  $('script, style, nav, footer').remove();
  const title = $('title').first().text().trim() || source.name;
  const text = stripHtml($('main').text() || $('body').text());

  return {
    id: `${source.id}-${slugify(title)}`,
    sourceId: source.id,
    sourceName: source.name,
    kind: source.kind,
    title,
    url: source.url,
    fetchedAt: new Date().toISOString(),
    summary: summarizeText(text, 4),
    tags: source.topicTags ?? [],
    status: 'ok'
  };
}

async function ingestWebWithFirecrawl(source) {
  const scraped = await scrapeWithFirecrawl(source.url);
  await writeRaw(source.id, scraped.raw);

  return {
    id: `${source.id}-${slugify(scraped.title)}`,
    sourceId: source.id,
    sourceName: source.name,
    kind: source.kind,
    scraper: 'firecrawl',
    title: scraped.title,
    url: scraped.url,
    fetchedAt: new Date().toISOString(),
    summary: summarizeText(scraped.markdown, 4),
    tags: source.topicTags ?? [],
    status: 'ok'
  };
}

async function ingestYoutube(source) {
  const transcript = await YoutubeTranscript.fetchTranscript(source.url);
  await writeRaw(source.id, transcript);
  const text = transcript.map((part) => part.text).join(' ');

  return {
    id: `${source.id}-${slugify(source.name)}`,
    sourceId: source.id,
    sourceName: source.name,
    kind: source.kind,
    title: source.name,
    url: source.url,
    fetchedAt: new Date().toISOString(),
    summary: summarizeText(text, 5),
    tags: source.topicTags ?? [],
    status: 'ok'
  };
}

async function writeRaw(id, payload) {
  await fs.writeFile(path.join(rawDir, `${slugify(id)}.json`), `${JSON.stringify(payload, null, 2)}\n`);
}
