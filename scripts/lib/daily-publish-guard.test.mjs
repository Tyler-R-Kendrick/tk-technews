import test from 'node:test';
import assert from 'node:assert/strict';
import { assertDailyPayloadIsPublishable } from './daily-publish-guard.mjs';

test('allows publishable daily payloads', () => {
  assert.doesNotThrow(() => {
    assertDailyPayloadIsPublishable({
      date: '2026-05-31',
      sourceItemCount: 3,
      articleStubs: [{ id: 'article-1' }]
    });
  });
});

test('rejects payloads with zero source items', () => {
  assert.throws(
    () => assertDailyPayloadIsPublishable({
      date: '2026-05-31',
      sourceItemCount: 0,
      articleStubs: [{ id: 'article-1' }]
    }),
    /sourceItemCount is 0/
  );
});

test('rejects payloads with zero article stubs', () => {
  assert.throws(
    () => assertDailyPayloadIsPublishable({
      date: '2026-05-31',
      sourceItemCount: 4,
      articleStubs: []
    }),
    /articleStubs is empty/
  );
});

test('supports explicit empty override', () => {
  assert.doesNotThrow(() => {
    assertDailyPayloadIsPublishable({
      date: '2026-05-31',
      sourceItemCount: 0,
      articleStubs: []
    }, {
      allowEmpty: true
    });
  });
});
