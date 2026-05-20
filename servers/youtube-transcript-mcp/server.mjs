#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { callTranscriptTool, toMcpJson } from './transcript-client.mjs';

const server = new McpServer({
  name: 'tk-technews-youtube-transcript',
  version: '0.1.0'
});

server.registerTool(
  'youtube_transcript_fetch',
  {
    title: 'Fetch YouTube Transcript',
    description: 'Fetch a transcript using jdepoix/youtube-transcript-api. Supports language priority, manual/generated selection, translation, and text/json/srt/vtt/raw formats.',
    inputSchema: {
      idOrUrl: z.string(),
      languages: z.union([z.string(), z.array(z.string())]).optional(),
      transcript_type: z.enum(['any', 'manual', 'generated']).default('any'),
      translate_to: z.string().optional(),
      preserve_formatting: z.boolean().default(false),
      format: z.enum(['json', 'text', 'srt', 'vtt', 'raw']).default('json')
    }
  },
  async (input) => toMcpJson(await callTranscriptTool({ action: 'fetch', ...input }))
);

server.registerTool(
  'youtube_transcript_list',
  {
    title: 'List YouTube Transcripts',
    description: 'List available transcript tracks for a YouTube video using jdepoix/youtube-transcript-api.',
    inputSchema: {
      idOrUrl: z.string(),
      languages: z.union([z.string(), z.array(z.string())]).optional()
    }
  },
  async (input) => toMcpJson(await callTranscriptTool({ action: 'list', ...input }))
);

const transport = new StdioServerTransport();
await server.connect(transport);
