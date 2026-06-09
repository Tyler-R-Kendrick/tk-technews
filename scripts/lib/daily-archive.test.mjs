import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertNavigableDailyBriefs,
  buildDailyArchiveSummary,
  buildDailyStaticPaths,
  dailyArchiveArtifactPaths,
  readArchiveIndex,
  writeDailyArtifacts
} from './daily-archive.mjs';

test('writeDailyArtifacts writes current files, dated archive files, and archive index', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'daily-archive-'));
  const payload = {
    date: '2026-06-08',
    generatedAt: '2026-06-08T15:20:14.697Z',
    sourceItemCount: 7,
    articleStubs: [{ slug: 'lead-story', title: 'Lead Story' }]
  };

  const result = writeDailyArtifacts(root, payload);
  const archivePaths = dailyArchiveArtifactPaths(payload.date);
  const srcArchivePayload = JSON.parse(await fs.readFile(path.join(root, archivePaths[0]), 'utf8'));
  const archiveIndex = readArchiveIndex(root);

  assert.equal(srcArchivePayload.date, payload.date);
  assert.ok(result.artifactPaths.includes('src/data/daily/archive-index.json'));
  assert.ok(result.artifactPaths.includes(archivePaths[0]));
  assert.equal(archiveIndex.days[0].date, payload.date);
  assert.equal(archiveIndex.days[0].leadSlug, 'lead-story');
});

test('buildDailyArchiveSummary sorts latest-first and preserves lead links', () => {
  const summary = buildDailyArchiveSummary([
    {
      date: '2026-06-07',
      generatedAt: '2026-06-07T15:20:14.697Z',
      sourceItemCount: 5,
      articleStubs: [{ slug: 'older-story', title: 'Older Story', href: '/daily/2026-06-07/older-story/' }]
    },
    {
      date: '2026-06-08',
      generatedAt: '2026-06-08T15:20:14.697Z',
      sourceItemCount: 7,
      articleStubs: [{ slug: 'latest-story', title: 'Latest Story', href: '/daily/2026-06-08/latest-story/' }]
    }
  ]);

  assert.deepEqual(summary.map((entry) => entry.date), ['2026-06-08', '2026-06-07']);
  assert.equal(summary[0].leadSlug, 'latest-story');
  assert.equal(summary[1].leadTitle, 'Older Story');
});

test('buildDailyStaticPaths returns route params for every archived article', () => {
  const paths = buildDailyStaticPaths([
    {
      date: '2026-06-08',
      articleStubs: [
        { slug: 'latest-story', title: 'Latest Story', href: '/daily/2026-06-08/latest-story/' },
        { slug: 'second-story', title: 'Second Story', href: '/daily/2026-06-08/second-story/' }
      ]
    }
  ]);

  assert.deepEqual(paths.map((entry) => entry.params), [
    { date: '2026-06-08', slug: 'latest-story' },
    { date: '2026-06-08', slug: 'second-story' }
  ]);
});

test('assertNavigableDailyBriefs rejects duplicate slugs and malformed hrefs', () => {
  assert.throws(
    () => assertNavigableDailyBriefs([
      {
        date: '2026-06-08',
        articleStubs: [
          { slug: 'latest-story', title: 'Latest Story', href: '/daily/2026-06-08/latest-story/' },
          { slug: 'latest-story', title: 'Latest Story Again', href: '/daily/2026-06-08/latest-story/' }
        ]
      }
    ]),
    /duplicate slug latest-story/
  );

  assert.throws(
    () => assertNavigableDailyBriefs([
      {
        date: '2026-06-08',
        articleStubs: [
          { slug: 'latest-story', title: 'Latest Story', href: '/daily/2026-06-07/latest-story/' }
        ]
      }
    ]),
    /unexpected href/
  );
});
