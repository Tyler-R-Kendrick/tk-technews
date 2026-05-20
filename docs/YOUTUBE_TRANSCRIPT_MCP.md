# YouTube Transcript MCP Server

This repo includes a local MCP server that wraps
`jdepoix/youtube-transcript-api`.

The upstream library retrieves YouTube transcripts/subtitles for a video,
including automatically generated subtitles, without requiring a YouTube Data API
key or headless browser. It also supports language priority, translation, and
formatters such as JSON, text, WebVTT, and SRT.

## Setup

Install the Python dependency:

```bash
python -m pip install -r servers/youtube-transcript-mcp/requirements.txt
```

## VS Code

Workspace registration lives in `.vscode/mcp.json`. VS Code should discover the
`tk-technews-youtube-transcript` server. Use the command palette:

```text
MCP: List Servers
```

The server does not need an API key.

## Tools

- `youtube_transcript_fetch`: fetch transcript text/data.
- `youtube_transcript_list`: list available transcript tracks.

## Fetch Options

`youtube_transcript_fetch` accepts:

- `idOrUrl`: YouTube video id or URL.
- `languages`: language priority array or comma-separated string, default `en`.
- `transcript_type`: `any`, `manual`, or `generated`.
- `translate_to`: optional target language code.
- `preserve_formatting`: preserve simple HTML formatting.
- `format`: `json`, `text`, `srt`, `vtt`, or `raw`.

## Notes

- This is different from YouTube Data API captions. It does not require OAuth,
  but availability depends on what YouTube exposes for the video.
- Some videos may be unavailable, age restricted, blocked, or rate limited.
- Respect YouTube terms and publisher restrictions.
