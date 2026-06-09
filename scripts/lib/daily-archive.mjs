import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const DAILY_CURRENT_ARTIFACT_PATHS = [
  'src/data/daily/generated-daily-articles.json',
  'public/daily/generated-daily-articles.json'
];

export const DAILY_ARCHIVE_INDEX_PATHS = [
  'src/data/daily/archive-index.json',
  'public/daily/archive-index.json'
];

export function dailyArchiveArtifactPaths(date) {
  return [
    `src/data/daily/archive/${date}.json`,
    `public/daily/archive/${date}.json`
  ];
}

export function writeDailyArtifacts(root, payload) {
  const archiveIndex = upsertArchiveIndex(readArchiveIndex(root), payload);
  const artifactPaths = [
    ...DAILY_CURRENT_ARTIFACT_PATHS,
    ...DAILY_ARCHIVE_INDEX_PATHS,
    ...dailyArchiveArtifactPaths(payload.date)
  ];

  for (const relativePath of DAILY_CURRENT_ARTIFACT_PATHS) {
    writeJson(root, relativePath, payload);
  }

  for (const relativePath of DAILY_ARCHIVE_INDEX_PATHS) {
    writeJson(root, relativePath, archiveIndex);
  }

  for (const relativePath of dailyArchiveArtifactPaths(payload.date)) {
    writeJson(root, relativePath, payload);
  }

  return { archiveIndex, artifactPaths };
}

export function readArchiveIndex(root) {
  for (const relativePath of DAILY_ARCHIVE_INDEX_PATHS) {
    try {
      return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
    } catch {
      continue;
    }
  }

  return { generatedAt: null, days: [] };
}

export function normalizeArchivedDailyBriefs(briefs) {
  return (Array.isArray(briefs) ? briefs : [])
    .filter((brief) => brief && typeof brief.date === 'string')
    .sort((left, right) => String(right.date).localeCompare(String(left.date)));
}

export function upsertArchiveIndex(existingIndex, payload) {
  const previousDays = Array.isArray(existingIndex?.days) ? existingIndex.days : [];
  const nextDays = [
    summarizeDailyPayload(payload),
    ...previousDays.filter((entry) => entry?.date !== payload.date)
  ];

  return {
    generatedAt: payload.generatedAt,
    days: buildDailyArchiveSummary(nextDays)
  };
}

export function summarizeDailyPayload(payload) {
  return {
    date: payload.date,
    generatedAt: payload.generatedAt,
    articleCount: Array.isArray(payload.articleStubs) ? payload.articleStubs.length : 0,
    sourceItemCount: Number(payload.sourceItemCount ?? 0),
    leadSlug: payload.articleStubs?.[0]?.slug ?? null,
    leadTitle: payload.articleStubs?.[0]?.title ?? null
  };
}

export function buildDailyArchiveSummary(briefs) {
  return normalizeArchivedDailyBriefs(briefs).map((brief) => {
    if (Array.isArray(brief?.articleStubs)) {
      return summarizeDailyPayload(brief);
    }

    return {
      date: brief.date,
      generatedAt: brief.generatedAt ?? null,
      articleCount: Number(brief.articleCount ?? 0),
      sourceItemCount: Number(brief.sourceItemCount ?? 0),
      leadSlug: brief.leadSlug ?? null,
      leadTitle: brief.leadTitle ?? null
    };
  });
}

export function buildDailyStaticPaths(briefs) {
  assertNavigableDailyBriefs(briefs);
  return normalizeArchivedDailyBriefs(briefs).flatMap((brief) =>
    (Array.isArray(brief.articleStubs) ? brief.articleStubs : []).map((stub) => ({
      params: { date: brief.date, slug: stub.slug },
      props: { brief, stub }
    }))
  );
}

export function assertNavigableDailyBriefs(briefs) {
  for (const brief of normalizeArchivedDailyBriefs(briefs)) {
    const seenSlugs = new Set();
    for (const stub of Array.isArray(brief.articleStubs) ? brief.articleStubs : []) {
      if (typeof stub?.slug !== 'string' || stub.slug.length === 0) {
        throw new Error(`Daily brief ${brief.date} contains an article without a slug`);
      }
      if (seenSlugs.has(stub.slug)) {
        throw new Error(`Daily brief ${brief.date} contains duplicate slug ${stub.slug}`);
      }
      seenSlugs.add(stub.slug);
      if (typeof stub?.title !== 'string' || stub.title.length === 0) {
        throw new Error(`Daily brief ${brief.date} contains slug ${stub.slug} without a title`);
      }
      if (stub.href !== `/daily/${brief.date}/${stub.slug}/`) {
        throw new Error(`Daily brief ${brief.date} slug ${stub.slug} had unexpected href ${stub.href}`);
      }
    }
  }
}

function writeJson(root, relativePath, value) {
  const targetPath = path.join(root, relativePath);
  mkdirSync(path.dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, `${JSON.stringify(value, null, 2)}\n`);
}
