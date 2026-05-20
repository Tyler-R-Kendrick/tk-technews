---
name: technews-research
description: Collect technology-news source material for TK TechNews. Use when an agent needs to fetch RSS feed items, scrape configured web pages, pull YouTube transcripts, refresh data/summaries/latest.json, or prepare source summaries before drafting an article in this repository.
---

# TechNews Research

Use this skill from the repository root.

## Workflow

1. Review `data/sources.json` and add or disable sources for the topic.
2. Review `data/monitored-sources.json` for YouTube categories and Google News RSS topics.
3. Run `npm run precompile:sources`.
4. Run `npm run ingest`.
5. Run `npm run extract:knowledge`.
6. Inspect `src/data/precompiled/`, `data/summaries/latest.json`, and `data/knowledge/latest.json` for failed sources, noisy summaries, missing citations, or weak entities.
7. If a source fails, either fix its configuration or leave the failure in the ledger for editorial review.

## Rules

- Prefer RSS feeds when available.
- Keep monitored YouTube and Google News source output in `src/data/precompiled/` so the static site can render it without runtime fetching.
- Use web scraping for stable publisher pages and source indexes.
- Use YouTube transcripts when available; do not infer video content when transcript fetch fails.
- Keep raw payloads in `data/raw/`; do not commit raw scraped content unless explicitly requested.
- Treat `data/knowledge/latest.json` as the local searchable knowledge snapshot for generated article drafts.
