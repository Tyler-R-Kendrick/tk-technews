import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildYouTubeUrl,
  requireCredentials,
  toMcpJson,
  extractYouTubeVideoId
} from './youtube-client.mjs';

test('builds YouTube Data API URLs with part and maxResults parameters', () => {
  const url = buildYouTubeUrl('channels', {
    part: ['snippet', 'contentDetails', 'statistics'],
    id: 'UC_x5XG1OV2P6uZZ5FSM9Ttw',
    maxResults: 5,
    key: 'test-key'
  });

  assert.equal(
    url.toString(),
    'https://www.googleapis.com/youtube/v3/channels?part=snippet%2CcontentDetails%2Cstatistics&id=UC_x5XG1OV2P6uZZ5FSM9Ttw&maxResults=5&key=test-key'
  );
});

test('requires API key for public metadata tools', () => {
  assert.throws(() => requireCredentials({}), /YOUTUBE_API_KEY/);
  assert.equal(requireCredentials({ YOUTUBE_API_KEY: 'abc' }).apiKey, 'abc');
});

test('requires OAuth token for captions tools', () => {
  assert.throws(() => requireCredentials({ YOUTUBE_API_KEY: 'abc' }, { needsOAuth: true }), /YOUTUBE_OAUTH_TOKEN/);
  assert.equal(
    requireCredentials({ YOUTUBE_API_KEY: 'abc', YOUTUBE_OAUTH_TOKEN: 'token' }, { needsOAuth: true }).oauthToken,
    'token'
  );
});

test('serializes MCP JSON text responses', () => {
  const result = toMcpJson({ ok: true });

  assert.deepEqual(result, {
    content: [
      {
        type: 'text',
        text: '{\n  "ok": true\n}'
      }
    ]
  });
});

test('extracts video ids from watch URLs, short URLs, and raw ids', () => {
  assert.equal(extractYouTubeVideoId('https://www.youtube.com/watch?v=PRU2ShMzQRg'), 'PRU2ShMzQRg');
  assert.equal(extractYouTubeVideoId('https://youtu.be/PRU2ShMzQRg'), 'PRU2ShMzQRg');
  assert.equal(extractYouTubeVideoId('PRU2ShMzQRg'), 'PRU2ShMzQRg');
});
