# TK TechNews

TK TechNews is a static Astro site for tracking AI and developer-tooling news from monitored sources, turning those sources into cited daily briefs, wiki pages, and article drafts.

Live site: https://tyler-r-kendrick.github.io/tk-technews/

Repository: https://github.com/Tyler-R-Kendrick/tk-technews

## What It Does

- Publishes a GitHub Pages site with the latest generated AI technology brief.
- Tracks source feeds from YouTube, RSS/news feeds, research blogs, GitHub organizations, and social profiles.
- Precompiles monitored source snapshots into static JSON used by the Astro pages.
- Generates daily article stubs by grouping related source items into story angles.
- Builds wiki/topic pages from a persisted knowledge graph.
- Includes narrator/evaluation scripts for keeping generated article and wiki copy consistent with the TK TechNews voice.

## Site Map

- Home: daily AI brief and generated article stubs.
- Sources: monitored source dashboard and recent source items.
- Wiki: generated topic explainers from the knowledge graph.
- Articles: longer cited explainers and weekly briefings.

## Quick Start

Requirements:

- Node.js 24 or newer is recommended. The GitHub Pages workflow builds with Node 24.
- npm, using the committed `package-lock.json`.

Install dependencies:

```sh
npm ci
```

Run the local dev server:

```sh
npm run dev
```

Build the static site:

```sh
npm run build
```

Preview the production build:

```sh
npm run preview
```

## Generate And Refresh Content

The published site is static, but most of the content is generated from repo data and scripts.

Refresh monitored source snapshots:

```sh
npm run precompile:sources
```

Generate daily article stubs:

```sh
npm run daily:generate
```

Run the agentic daily source generation pipeline:

```sh
npm run daily:agentic
```

Generate wiki content:

```sh
npm run wiki:generate
```

Run the broader source-to-article pipeline:

```sh
npm run pipeline
```

## Configuration

Start by copying `.env.example` to `.env` when you need API-backed ingestion or generation:

```sh
cp .env.example .env
```

Optional environment variables include:

- `OPENAI_API_KEY`: reserved for LLM-backed summarization and generation.
- `AI_GATEWAY_API_KEY`: enables Vercel AI Gateway usage through the AI SDK.
- `TK_TECHNEWS_INFERENCE_PROVIDER`: inference routing for the durable source pipeline.
- `TK_TECHNEWS_MODEL`, `TK_TECHNEWS_CODEX_MODEL`, `TK_TECHNEWS_COPILOT_MODEL`: model selection for generation paths.
- `FIRECRAWL_API_KEY`: enables Firecrawl-backed scraping for dynamic pages.
- `YOUTUBE_API_KEY`: enables the YouTube Data API MCP server.
- `YOUTUBE_OAUTH_TOKEN`: optional OAuth token for YouTube caption and authenticated calls.

The site can still build from committed data without these keys.

## Customize The Project

Common customization points:

- Source list: edit `data/monitored-sources.json`.
- Static source seed data: edit `data/sources.json`.
- Voice profiles: edit files in `data/voice/`.
- Generated daily data: inspect or replace `src/data/daily/generated-daily-articles.json`.
- Generated wiki data: inspect or replace `src/data/wiki/generated-wiki.json`.
- Precompiled source snapshots: refresh or replace files in `src/data/precompiled/`.
- Pages and layouts: edit `src/pages/`, `src/layouts/`, and `src/styles/global.css`.
- Site URL/base path: update `site` and `base` in `astro.config.mjs`.

If you fork the repository and deploy to a different GitHub Pages project URL, update `astro.config.mjs`:

```js
export default defineConfig({
  site: 'https://your-user.github.io',
  base: '/your-repo-name'
});
```

For a custom domain or user/organization Pages site at the root, adjust or remove `base` to match the deployed path.

## Deployment

GitHub Pages deployment is handled by `.github/workflows/deploy-pages.yml`.

On every push to `main`, GitHub Actions:

1. Checks out the repository.
2. Runs the Astro build through `withastro/action`.
3. Uploads the generated static site artifact.
4. Deploys it to GitHub Pages.

The repository must have GitHub Pages enabled with the source set to GitHub Actions. The current production URL is:

https://tyler-r-kendrick.github.io/tk-technews/

## Validation

Useful checks before opening a pull request:

```sh
npm run build
npm test
npm run eval:narrator:fixtures
npm run eval:daily-social:fixtures
```

The full build already runs `astro check` before `astro build`.

## Supporting Docs

- `DESIGN.md`: product and interface direction.
- `docs/GOAL_AND_PATTERNS.md`: project goals and content-generation patterns.
- `docs/WEBSCRAPING.md`: web scraping notes.
- `docs/YOUTUBE_MCP.md`: YouTube Data API MCP setup.
- `docs/YOUTUBE_TRANSCRIPT_MCP.md`: YouTube transcript MCP setup.
