#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  callYouTube,
  downloadCaptionTrack,
  extractYouTubeVideoId,
  toMcpJson
} from './youtube-client.mjs';

const server = new McpServer({
  name: 'tk-technews-youtube-data',
  version: '0.1.0'
});

server.registerTool(
  'youtube_channels_get',
  {
    title: 'Get YouTube Channel Info',
    description: 'Fetch channel snippet, contentDetails, and statistics by channel id, username, handle, or mine=true.',
    inputSchema: {
      id: z.string().optional(),
      forUsername: z.string().optional(),
      forHandle: z.string().optional(),
      mine: z.boolean().optional(),
      part: z.array(z.string()).default(['snippet', 'contentDetails', 'statistics'])
    }
  },
  async ({ id, forUsername, forHandle, mine, part }) => toMcpJson(await callYouTube('channels', {
    part,
    id,
    forUsername,
    forHandle,
    mine
  }, { needsOAuth: Boolean(mine) }))
);

server.registerTool(
  'youtube_playlists_list',
  {
    title: 'List YouTube Playlists',
    description: 'Fetch playlists by channel id, playlist id, or mine=true.',
    inputSchema: {
      channelId: z.string().optional(),
      id: z.string().optional(),
      mine: z.boolean().optional(),
      maxResults: z.number().int().min(1).max(50).default(25),
      pageToken: z.string().optional(),
      part: z.array(z.string()).default(['snippet', 'contentDetails'])
    }
  },
  async ({ channelId, id, mine, maxResults, pageToken, part }) => toMcpJson(await callYouTube('playlists', {
    part,
    channelId,
    id,
    mine,
    maxResults,
    pageToken
  }, { needsOAuth: Boolean(mine) }))
);

server.registerTool(
  'youtube_playlist_items_list',
  {
    title: 'List YouTube Playlist Items',
    description: 'Fetch videos/items in a playlist, including uploads playlists from channel contentDetails.',
    inputSchema: {
      playlistId: z.string(),
      maxResults: z.number().int().min(1).max(50).default(25),
      pageToken: z.string().optional(),
      part: z.array(z.string()).default(['snippet', 'contentDetails'])
    }
  },
  async ({ playlistId, maxResults, pageToken, part }) => toMcpJson(await callYouTube('playlistItems', {
    part,
    playlistId,
    maxResults,
    pageToken
  }))
);

server.registerTool(
  'youtube_videos_get',
  {
    title: 'Get YouTube Video Info',
    description: 'Fetch video snippet, contentDetails, statistics, status, and liveStreamingDetails by video id or URL.',
    inputSchema: {
      idOrUrl: z.string(),
      part: z.array(z.string()).default(['snippet', 'contentDetails', 'statistics', 'status', 'liveStreamingDetails'])
    }
  },
  async ({ idOrUrl, part }) => toMcpJson(await callYouTube('videos', {
    part,
    id: extractYouTubeVideoId(idOrUrl)
  }))
);

server.registerTool(
  'youtube_search',
  {
    title: 'Search YouTube',
    description: 'Search YouTube videos, channels, or playlists with the Data API search.list endpoint.',
    inputSchema: {
      q: z.string(),
      channelId: z.string().optional(),
      type: z.array(z.enum(['video', 'channel', 'playlist'])).default(['video']),
      order: z.enum(['date', 'rating', 'relevance', 'title', 'videoCount', 'viewCount']).default('relevance'),
      publishedAfter: z.string().optional(),
      publishedBefore: z.string().optional(),
      maxResults: z.number().int().min(1).max(50).default(10),
      pageToken: z.string().optional(),
      part: z.array(z.string()).default(['snippet'])
    }
  },
  async ({ q, channelId, type, order, publishedAfter, publishedBefore, maxResults, pageToken, part }) => toMcpJson(await callYouTube('search', {
    part,
    q,
    channelId,
    type,
    order,
    publishedAfter,
    publishedBefore,
    maxResults,
    pageToken
  }))
);

server.registerTool(
  'youtube_captions_list',
  {
    title: 'List YouTube Caption Tracks',
    description: 'List caption tracks for a video. YouTube requires OAuth 2.0 authorization for captions.list.',
    inputSchema: {
      videoIdOrUrl: z.string(),
      part: z.array(z.string()).default(['snippet'])
    }
  },
  async ({ videoIdOrUrl, part }) => toMcpJson(await callYouTube('captions', {
    part,
    videoId: extractYouTubeVideoId(videoIdOrUrl)
  }, { needsOAuth: true }))
);

server.registerTool(
  'youtube_captions_download',
  {
    title: 'Download YouTube Caption Track',
    description: 'Download a caption track by caption track id. YouTube requires OAuth 2.0 authorization for captions.download.',
    inputSchema: {
      id: z.string(),
      tfmt: z.enum(['sbv', 'scc', 'srt', 'ttml', 'vtt']).optional(),
      tlang: z.string().length(2).optional()
    }
  },
  async ({ id, tfmt, tlang }) => toMcpJson(await downloadCaptionTrack({ id, tfmt, tlang }))
);

const transport = new StdioServerTransport();
await server.connect(transport);
