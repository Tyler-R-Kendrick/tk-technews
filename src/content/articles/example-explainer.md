---
title: "Example Explainer: How This Pipeline Turns Sources Into a Draft"
description: "A seed article showing the intended cited-article shape before live ingestion is refined."
pubDate: "2026-05-19"
sourceCount: 3
tags:
  - pipeline
  - citations
citations:
  - title: "Configured RSS source"
    url: "https://hnrss.org/frontpage"
    source: "Hacker News RSS"
  - title: "Configured publisher source"
    url: "https://openai.com/news/"
    source: "OpenAI News"
  - title: "Configured technology source"
    url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml"
    source: "The Verge AI RSS"
---

## What the draft does

This article is a placeholder for the first version of the publishing loop. The
site is intentionally static at request time, but the repository includes scripts
that can fetch sources, normalize summaries, and generate a Markdown article with
frontmatter citations.

## Why citations are first-class

Every generated article should preserve a source ledger before it makes a claim.
The reader-facing citation rail mirrors the article frontmatter, which keeps
source review possible before publishing and keeps the static page simple.

## Intended next refinement

The current summarizer is extractive and conservative. The next pass can add an
LLM-backed synthesis step, but it should keep the same JSON summary contract and
the same citation validation gate.
