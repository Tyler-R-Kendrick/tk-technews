# Web Scraping

TK TechNews uses two scraping paths:

1. Generic local extraction with `fetch` and `cheerio`.
2. Firecrawl for dynamic, JavaScript-heavy, or bot-resistant pages.

Firecrawl is configured as both an MCP server and a direct script-backed scraper.
Use Firecrawl when the local extractor returns navigation chrome, empty text, or
partial content.

## MCP Configuration

The repo includes `.mcp.json`:

```json
{
  "mcpServers": {
    "firecrawl": {
      "command": "npx",
      "args": ["-y", "firecrawl-mcp"],
      "env": {
        "FIRECRAWL_API_KEY": "${FIRECRAWL_API_KEY}"
      }
    }
  }
}
```

Set `FIRECRAWL_API_KEY` in the shell or `.env`, then restart the agent so MCP
configuration is reloaded.

## Project Commands

Scrape one URL through Firecrawl:

```bash
npm run scrape:firecrawl -- --url https://example.com/article
```

Run the normal publishing pipeline:

```bash
npm run pipeline -- --topic "Article Title"
```

`data/sources.json` can mark a web source with `"scraper": "firecrawl"`. During
`npm run ingest`, Firecrawl is used when `FIRECRAWL_API_KEY` is present. If no
key is present, the local extractor remains the fallback.

## Source Discipline

- Respect publisher terms, robots policies, and paywalls.
- Prefer RSS feeds for publishers that provide them.
- Use Firecrawl for extraction quality, not to bypass access controls.
- Keep raw scraped payloads in ignored `data/raw/`.
- Keep article claims linked to frontmatter citations.
