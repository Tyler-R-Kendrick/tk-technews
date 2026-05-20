---
name: technews-webscrape
description: Configure and use reputable web scraping for TK TechNews. Use when an agent needs Firecrawl MCP, Firecrawl-backed scraping, dynamic page extraction, web source troubleshooting, or guidance on when to use RSS, local scraping, Firecrawl, or YouTube transcripts for cited article generation.
---

# TechNews Webscrape

Use this skill from the repository root when a web source needs higher-quality
extraction than the default local `fetch` plus `cheerio` scraper.

## Preferred Scraper

Use Firecrawl as the reputable external scraper. The repo has:

- `.mcp.json` for MCP-aware agents: `npx -y firecrawl-mcp`.
- `npm run scrape:firecrawl -- --url <url>` for one-off extraction checks.
- `data/sources.json` support for `"scraper": "firecrawl"` on web sources.

## Workflow

1. Confirm `FIRECRAWL_API_KEY` is set before expecting MCP or Firecrawl scraping to work.
2. For one URL, run `npm run scrape:firecrawl -- --url "https://example.com/article"`.
3. For configured sources, add `"scraper": "firecrawl"` to the source and run `npm run ingest`.
4. Inspect `data/summaries/latest.json` and `data/raw/firecrawl/` for extraction quality.
5. Run `npm run extract:knowledge`, `npm run draft -- --topic "..."`, and `npm run validate:citations`.

## Selection Rules

- Prefer RSS when the publisher offers a stable feed.
- Use local scraping for simple static pages.
- Use Firecrawl for dynamic pages, pages with heavy chrome, or pages where local extraction misses main content.
- Use YouTube transcript ingestion for videos.
- Do not use scraping to bypass paywalls, access controls, or publisher restrictions.
