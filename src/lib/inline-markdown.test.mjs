import test from 'node:test';
import assert from 'node:assert/strict';
import { renderInlineMarkdown } from './inline-markdown.mjs';

test('renderInlineMarkdown renders http markdown links as anchors', () => {
  const html = renderInlineMarkdown('See [source](https://example.com/report?x=1) for details.');

  assert.equal(html, 'See <a href="https://example.com/report?x=1" rel="noreferrer">source</a> for details.');
});

test('renderInlineMarkdown escapes non-link html before rendering links', () => {
  const html = renderInlineMarkdown('<script>alert("x")</script> [safe](https://example.com)');

  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.match(html, /<a href="https:\/\/example\.com" rel="noreferrer">safe<\/a>/);
});
