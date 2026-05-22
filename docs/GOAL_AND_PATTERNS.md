# TK TechNews Goal And Patterns

## Goal

Build a mostly static Astro publication that turns source material into cited
technology explainers. The site should be static at read time, while repository
scripts and agent skills do the collection, summarization, drafting, validation,
and editorial handoff work ahead of publishing.

## Intended Pipeline

1. Configure sources in `data/sources.json`.
2. Configure monitored YouTube channels and Google News RSS topics in
   `data/monitored-sources.json`.
3. Run `npm run precompile:sources` to pull monitored YouTube channel feeds and
   Google News RSS topics into `src/data/precompiled/`.
   `npm run daily:generate` runs this precompile step before writing the daily
   homepage/article-stub artifacts, so the public daily brief does not reuse a
   stale `source-index.json`.
4. Run `npm run ingest` to collect RSS entries, web page text, and YouTube
   transcripts where available.
5. Store raw source payloads in `data/raw/` and normalized summaries in
   `data/summaries/latest.json`.
6. Run `npm run extract:knowledge` to build a bounded knowledge model in
   `data/knowledge/latest.json`.
7. Run `npm run draft -- --topic "Article Title"` to generate a Markdown draft
   in `src/content/articles/`.
8. Run `npm test`, `npm run validate:citations`, and `npm run build` before publishing.

## Durable Source-To-Article Pipeline

The durable pipeline lives beside the original snapshot pipeline. It starts from
one URI, persists each processing stage, and writes graph relationships so a
later run can understand what has already been seen.

Commands:

1. `npm run source:ingest -- --uri "https://example.com/article"` stores a
   `SourceDocument` in `data/ledger/source-docs.jsonl` and graph nodes in
   `data/graph/kg.jsonld`.
2. `npm run source:brief -- --source-doc-id "source-doc:..."` creates a cited
   source brief from a parsed source document.
3. `npm run source:enrich -- --source-doc-id "source-doc:..."` adds graph-aware
   entities, claims, relationships, temporal events, and applied opportunities.
4. `npm run aggregate:brief -- --date "YYYY-MM-DD"` summarizes enriched docs for
   that `America/Chicago` calendar day.
5. `npm run article:generate -- --aggregate-id "aggregate-brief:..." --voice tk-technews`
   writes a Markdown article to `src/content/articles/`.

The shorthand commands are `npm run pipeline:source -- --uri "..."` and
`npm run pipeline:daily -- --date "YYYY-MM-DD"`.

Durable records are append-only JSONL files under `data/ledger/`. The current
knowledge graph is `data/graph/kg.jsonld`, with per-artifact JSON-LD snapshots
under `data/rdf/`.

## Generated Wiki Pattern

Run `npm run wiki:generate` after graph updates to create
`src/data/wiki/generated-wiki.json` and `public/wiki/generated-wiki.json`.
The generator reads `data/graph/kg.jsonld`, derives node neighborhoods, and asks
inference to shape landing-page and topic-page copy from those graph
communities. Astro renders `/wiki/` and any generated `/wiki/[slug]/` pages from
that static artifact.

Wiki page topics, links, node ids, and citations must come from graph-derived
communities, not hand-coded page lists. The browser stores the rendered wiki
payload in `localStorage` under a graph-hash cache key so revisiting the same
rendered graph does not require client-side regeneration.

Failed fetch, parse, or inference attempts must not be treated as complete. They
are written as `revisit_pending` with a reason code in
`data/ledger/revisit-queue.jsonl`. The next run checks whether the reason appears
resolved before spending work on a full retry.

## Content Contract

Articles are Markdown files in `src/content/articles/`. Frontmatter should keep
reader-facing metadata and citations together:

```yaml
title: "Article title"
description: "One-sentence summary"
pubDate: "2026-05-19"
sourceCount: 4
tags:
  - ai
citations:
  - title: "Source title"
    url: "https://example.com/source"
    source: "Publisher name"
```

## Source Patterns

- RSS is the lowest-friction source and should remain the default for publisher
  feeds.
- Monitored sources are precompiled into static JSON assets:
  `src/data/precompiled/source-index.json`, `youtube-latest.json`, and
  `google-news-latest.json`.
- Web scraping should remove navigation, scripts, styles, and footers before
  summarization. Per-site adapters can be added later when generic extraction is
  too noisy.
- YouTube ingestion should prefer transcripts. If transcripts are unavailable,
  capture the failure in the summary ledger instead of inventing a summary.
- YouTube channel, playlist, video, search, and caption metadata should use the
  local YouTube Data MCP server when an agent is doing interactive source
  discovery from VS Code.
- Raw payloads should remain untracked so drafts can be regenerated locally
  without committing bulky or copyrighted source material.

## Summarization Pattern

The first draft uses conservative extractive summaries. A later LLM synthesis
step can be added behind the same `data/summaries/latest.json` contract. The
important constraint is that every generated claim should be traceable to one or
more source URLs in article frontmatter.

LLM-backed durable steps use `scripts/lib/inference.mjs`. The provider order is
AI SDK first, local Codex SDK second, and GitHub Copilot SDK third. Each provider
must return schema-valid JSON; failed validation retries with the same provider
before moving to the next fallback.

## Knowledge Modeling Pattern

The first knowledge-modeling pass follows the useful shape from
`vercel-labs/knowledge-agent-template`: normalize sources into a searchable file
ledger, extract bounded knowledge artifacts, then let the article generator use
that structured context instead of reading raw source blobs directly.

`data/knowledge/latest.json` is the local snapshot. It contains:

- `sources`: normalized source records.
- `topics`: source tags grouped with evidence ids and citations.
- `entities`: capitalized named-entity candidates with evidence ids.
- `claims`: extractive claim candidates, each with a citation.
- `relationships`: co-mentioned entity pairs with evidence ids.

The extractor is deliberately deterministic for now. A future LLM-backed
extractor should keep this JSON contract and continue to attach citations to
every claim.

The durable graph pipeline extends this into a multi-modal temporal graph. V1
stores media references as URI metadata, text and transcript content as
citation-addressable spans, and relations as JSON-LD edges. Applied opportunity
nodes are allowed, but they must be labeled as speculation and tied to cited
evidence.

## Agent Skill Pattern

Repo-local skills live in `skills/`. Each skill should be small:

- `SKILL.md` explains when to use it and the command sequence.
- `scripts/` contains deterministic helpers only when the skill needs behavior
  that does not already exist in top-level `scripts/`.
- The skill should call repo commands such as `npm run ingest` rather than
  duplicating pipeline logic in prose.

Use `skills/technews-durable-pipeline/SKILL.md` for the durable source-to-article
workflow.

## Near-Term Refinements

- Add source-specific extractors for high-value sites.
- Add an optional LLM synthesis command that emits the same article contract.
- Add topic clustering so one ingest pass can produce multiple article drafts.
- Add editorial status fields for draft, review, and published content.
- Add CI that runs citation validation and Astro build on pull requests.
