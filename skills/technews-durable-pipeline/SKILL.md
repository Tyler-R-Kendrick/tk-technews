---
name: technews-durable-pipeline
description: Run the durable TK TechNews source-to-article pipeline. Use when an agent needs to ingest one URI, create a cited source brief, enrich it into the temporal knowledge graph, aggregate enriched docs by day, or generate an Astro article from an aggregate brief.
---

# TechNews Durable Pipeline

Use this skill from the repository root.

## Single Source Workflow

1. Ingest and parse one source URI:
   `npm run source:ingest -- --uri "https://example.com/article"`
2. If the source returns `status: "parsed"`, create the cited source brief:
   `npm run source:brief -- --source-doc-id "source-doc:..."`
3. Enrich the parsed and briefed source into the temporal knowledge graph:
   `npm run source:enrich -- --source-doc-id "source-doc:..."`
4. To run all source steps together:
   `npm run pipeline:source -- --uri "https://example.com/article"`

## Daily Publishing Workflow

1. Aggregate enriched docs for a local calendar day:
   `npm run aggregate:brief -- --date "2026-05-20"`
2. Generate an article from the aggregate brief:
   `npm run article:generate -- --aggregate-id "aggregate-brief:..." --voice tk-technews`
3. To run both daily steps together:
   `npm run pipeline:daily -- --date "2026-05-20" --voice tk-technews`

## Rules

- Do not process `revisit_pending` source docs through briefing or enrichment.
- Failed fetch, parse, or inference attempts are not done; inspect `data/ledger/revisit-queue.jsonl`.
- Check `data/graph/kg.jsonld` for graph state and `data/rdf/` for per-artifact JSON-LD.
- Generated articles must pass `npm run validate:citations`, `npm test`, and `npm run build`.
- Speculative applied opportunities must stay explicitly labeled and cite graph-backed evidence.
