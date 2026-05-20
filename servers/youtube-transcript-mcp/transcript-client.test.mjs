import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPythonInvocation,
  extractYouTubeVideoId,
  normalizeLanguages,
  toMcpJson
} from './transcript-client.mjs';

test('extracts YouTube video ids from watch URLs, shorts URLs, embed URLs, and raw ids', () => {
  assert.equal(extractYouTubeVideoId('https://www.youtube.com/watch?v=PRU2ShMzQRg'), 'PRU2ShMzQRg');
  assert.equal(extractYouTubeVideoId('https://www.youtube.com/shorts/PRU2ShMzQRg'), 'PRU2ShMzQRg');
  assert.equal(extractYouTubeVideoId('https://www.youtube.com/embed/PRU2ShMzQRg'), 'PRU2ShMzQRg');
  assert.equal(extractYouTubeVideoId('https://youtu.be/PRU2ShMzQRg'), 'PRU2ShMzQRg');
  assert.equal(extractYouTubeVideoId('PRU2ShMzQRg'), 'PRU2ShMzQRg');
});

test('normalizes language inputs into priority arrays', () => {
  assert.deepEqual(normalizeLanguages(undefined), ['en']);
  assert.deepEqual(normalizeLanguages('de,en'), ['de', 'en']);
  assert.deepEqual(normalizeLanguages(['de', 'en']), ['de', 'en']);
});

test('builds Python helper invocation using JSON stdin', () => {
  const invocation = buildPythonInvocation({
    action: 'fetch',
    idOrUrl: 'https://youtu.be/PRU2ShMzQRg',
    languages: ['en'],
    format: 'json'
  });

  assert.equal(invocation.command, 'python');
  assert.deepEqual(invocation.args, ['servers/youtube-transcript-mcp/transcript_tool.py']);
  assert.equal(JSON.parse(invocation.stdin).video_id, 'PRU2ShMzQRg');
});

test('serializes MCP JSON text responses', () => {
  assert.deepEqual(toMcpJson({ ok: true }), {
    content: [
      {
        type: 'text',
        text: '{\n  "ok": true\n}'
      }
    ]
  });
});
