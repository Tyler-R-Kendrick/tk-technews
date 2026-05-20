# YouTube Data MCP Server

This repo includes a local MCP server for the YouTube Data API v3.

## VS Code

Workspace registration lives in `.vscode/mcp.json`. VS Code should discover the
`tk-technews-youtube-data` server from this workspace. Use the command palette:

```text
MCP: List Servers
```

Start the server and provide:

- `YOUTUBE_API_KEY`: required for public channel, playlist, playlist item, video,
  and search metadata calls.
- `YOUTUBE_OAUTH_TOKEN`: optional, required for captions and `mine=true` calls.

## Local Server

Run the stdio server directly:

```bash
node servers/youtube-data-mcp/server.mjs
```

The server is intended for MCP clients, so direct terminal execution waits for
JSON-RPC messages on stdin.

## Tools

- `youtube_channels_get`
- `youtube_playlists_list`
- `youtube_playlist_items_list`
- `youtube_videos_get`
- `youtube_search`
- `youtube_captions_list`
- `youtube_captions_download`

## Captions

The YouTube captions implementation guide states that `captions.list` and
`captions.download` require OAuth 2.0 authorization. API-key-only access is not
enough for those tools. The server therefore requires `YOUTUBE_OAUTH_TOKEN` for
caption operations.

## Notes

- Prefer API-key tools for public metadata and discovery.
- Use OAuth only for caption tracks or authenticated user/channel operations.
- Respect YouTube API quota and terms.
