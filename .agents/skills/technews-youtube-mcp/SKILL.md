---
name: technews-youtube-mcp
description: Use the local TK TechNews YouTube Data API MCP server. Trigger when an agent needs YouTube channel info, playlist info, playlist videos, video metadata, YouTube search, caption track listing, caption downloads, or VS Code MCP setup for the repo's local YouTube server.
---

# TechNews YouTube MCP

Use this skill from the repository root.

## Server

The local MCP server is `servers/youtube-data-mcp/server.mjs`.

VS Code registration lives in `.vscode/mcp.json` as
`tk-technews-youtube-data`.

## Credentials

- `YOUTUBE_API_KEY` is required for public channel, playlist, playlist item,
  video, and search tools.
- `YOUTUBE_OAUTH_TOKEN` is required for `youtube_captions_list`,
  `youtube_captions_download`, and `mine=true` requests.

Captions require OAuth 2.0 according to the YouTube Data API captions
implementation guide.

## Tools

- `youtube_channels_get`
- `youtube_playlists_list`
- `youtube_playlist_items_list`
- `youtube_videos_get`
- `youtube_search`
- `youtube_captions_list`
- `youtube_captions_download`

## Workflow

1. Confirm VS Code sees `tk-technews-youtube-data` with `MCP: List Servers`.
2. Start the server from VS Code and provide credentials when prompted.
3. Use public metadata tools for channel, playlist, video, and search discovery.
4. Use captions tools only when an OAuth bearer token is available.
5. Preserve returned source URLs and IDs in article citations or source ledgers.
