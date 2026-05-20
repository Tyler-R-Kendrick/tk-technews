---
name: technews-youtube-transcript-mcp
description: Use the local TK TechNews MCP server wrapping jdepoix/youtube-transcript-api. Trigger when an agent needs YouTube transcripts, generated subtitles, transcript language discovery, translation, SRT/VTT/text/JSON transcript output, or VS Code MCP setup for transcript extraction without a YouTube Data API key.
---

# TechNews YouTube Transcript MCP

Use this skill from the repository root.

## Server

The local MCP server is `servers/youtube-transcript-mcp/server.mjs`.

VS Code registration lives in `.vscode/mcp.json` as
`tk-technews-youtube-transcript`.

Install the Python dependency:

```bash
python -m pip install -r servers/youtube-transcript-mcp/requirements.txt
```

## Tools

- `youtube_transcript_fetch`
- `youtube_transcript_list`

## Workflow

1. Confirm VS Code sees `tk-technews-youtube-transcript` with `MCP: List Servers`.
2. Use `youtube_transcript_list` to inspect languages and whether tracks are generated/manual.
3. Use `youtube_transcript_fetch` with `format: "text"` for article summarization or `format: "raw"` for timestamped data.
4. Use `languages` as a priority list, for example `["en", "en-US"]`.
5. Use `translate_to` only when the transcript track is translatable.

## Rules

- This server does not require a YouTube Data API key.
- Do not treat transcript availability as guaranteed; videos can be unavailable, blocked, or rate limited.
- Preserve video IDs and URLs in source ledgers and article citations.
