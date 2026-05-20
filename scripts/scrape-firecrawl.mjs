import fs from 'node:fs/promises';
import path from 'node:path';
import { scrapeWithFirecrawl } from './lib/firecrawl-client.mjs';
import { slugify, summarizeText } from './lib/text-utils.mjs';

const args = parseArgs(process.argv.slice(2));
const url = args.url;

if (!url) {
  throw new Error('Usage: npm run scrape:firecrawl -- --url https://example.com/article');
}

const result = await scrapeWithFirecrawl(url);
const output = {
  id: slugify(result.url),
  title: result.title,
  url: result.url,
  fetchedAt: new Date().toISOString(),
  summary: summarizeText(result.markdown, 4),
  markdown: result.markdown,
  metadata: result.metadata
};

const outputDir = path.join(process.cwd(), 'data', 'raw', 'firecrawl');
await fs.mkdir(outputDir, { recursive: true });
const outputPath = path.join(outputDir, `${output.id}.json`);
await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);

console.log(`Wrote Firecrawl scrape to ${outputPath}`);

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (!value.startsWith('--')) continue;
    const key = value.slice(2);
    const next = argv[i + 1];
    parsed[key] = next && !next.startsWith('--') ? next : 'true';
  }
  return parsed;
}
