---
name: technews-draft
description: Draft cited TK TechNews articles from the normalized source summary ledger. Use when an agent needs to turn data/summaries/latest.json into a Markdown article, preserve citations in frontmatter, or create an initial explainer draft for editorial refinement.
---

# TechNews Draft

Use this skill from the repository root after `technews-research` has produced
`data/summaries/latest.json` and ideally `data/knowledge/latest.json`.

## Workflow

1. Choose a concrete article title and optional slug.
2. If needed, run `npm run extract:knowledge` to refresh the knowledge model.
3. Run `npm run draft -- --topic "Article Title"`.
4. Open the generated file in `src/content/articles/`.
5. Use the `## Knowledge model` section to strengthen the explanation, entities, and relationships.
6. Strengthen the `## What it means` section while preserving citation links.
7. Run `npm run validate:citations`.

## Rules

- Do not add uncited source links to the body.
- Keep frontmatter `citations` synchronized with article links.
- Treat generated prose as a draft; improve the explanation before publication.
