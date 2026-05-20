import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWeeklyLedgerFromPrecompiled } from './precompiled-weekly-ledger.mjs';

test('builds a weekly summary ledger from all precompiled source families', () => {
  const ledger = buildWeeklyLedgerFromPrecompiled({
    generatedAt: '2026-05-20T12:00:00.000Z',
    startDate: '2026-05-13',
    endDate: '2026-05-20',
    assets: {
      youtube: {
        sources: [{
          id: 'youtube-news-openai',
          title: 'OpenAI Channel',
          category: 'news',
          items: [
            {
              title: 'New agents',
              link: 'https://example.com/agents',
              publishedAt: '2026-05-14T10:00:00.000Z',
              summary: '',
              transcriptSummary: 'Transcript says OpenAI demonstrated multi-step agent workflows, tool use, and code review automation.',
              transcript: {
                videoId: 'abc123',
                status: 'ok',
                text: 'OpenAI demonstrated multi-step agent workflows, tool use, and code review automation.'
              }
            },
            { title: 'Old agents', link: 'https://example.com/old', publishedAt: '2026-05-01T10:00:00.000Z', summary: 'Old update.' }
          ]
        }]
      },
      googleNews: {
        sources: [{
          id: 'google-news-openai',
          topic: 'openai',
          title: 'OpenAI News',
          items: [
            { title: 'New agents duplicate', link: 'https://example.com/agents', publishedAt: '2026-05-15T10:00:00.000Z', summary: 'Duplicate.' },
            { title: 'Model story', link: 'https://example.com/model', publishedAt: '2026-05-16T10:00:00.000Z', summary: 'Model update.' }
          ]
        }]
      }
    }
  });

  assert.equal(ledger.sourceCount, 2);
  assert.equal(ledger.itemCount, 2);
  assert.deepEqual(ledger.window, { startDate: '2026-05-13', endDate: '2026-05-20' });
  assert.deepEqual(ledger.items.map((item) => item.url).sort(), [
    'https://example.com/agents',
    'https://example.com/model'
  ]);
  assert.ok(ledger.items.every((item) => item.status === 'ok'));
  assert.match(ledger.items.find((item) => item.url === 'https://example.com/agents').summary, /multi-step agent workflows/);
  assert.equal(ledger.items.find((item) => item.url === 'https://example.com/agents').transcript.status, 'ok');
});
