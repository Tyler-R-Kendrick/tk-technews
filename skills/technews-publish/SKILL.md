---
name: technews-publish
description: Validate and publish TK TechNews static Astro content. Use when an agent needs to check citation integrity, run the Astro build, preview the site, or prepare a generated article for commit or deployment.
---

# TechNews Publish

Use this skill from the repository root after article drafting or editing.

## Workflow

1. Run `npm run validate:citations`.
2. Run `npm test`.
3. Run `npm run build`.
4. If the user asks for visual review, run `npm run dev` and inspect the home page plus the generated article page.
5. Fix citation, Markdown, extraction, or Astro errors before handing off.

## Rules

- A page is not publication-ready until citations validate and the Astro build passes.
- Knowledge-model changes should keep `npm test` green.
- Keep generated raw source data untracked unless the user explicitly asks to preserve it.
