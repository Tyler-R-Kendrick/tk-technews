import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { z } from 'zod';
import {
  appendLedgerRecord,
  appendRelation,
  canonicalizeUri,
  latestRecordById,
  latestRecordWhere,
  nowIso,
  readLedger,
  sourceDocIdForUri,
  stableHash
} from './ledger-store.mjs';
import { frontmatterString, slugify, stripHtml } from './text-utils.mjs';
import { canonicalUrlKey } from './rich-citations.mjs';
import {
  addArtifactAndPersist,
  findRelatedGraphContext,
  loadKnowledgeGraph
} from './temporal-knowledge-graph.mjs';
import { generateStructuredObject } from './inference.mjs';
import { runGeneratedOutputLoop } from './generation-loop.mjs';

export const SOURCE_STATES = new Set([
  'discovered',
  'fetched',
  'parsed',
  'revisit_pending',
  'blocked_manual',
  'briefed',
  'enriched',
  'aggregated',
  'article_published'
]);

export const REASON_CODES = new Set([
  'http_401',
  'http_403',
  'http_404',
  'http_429',
  'http_5xx',
  'timeout',
  'empty_body',
  'unsupported_content_type',
  'parse_empty_text',
  'rss_item_missing',
  'youtube_transcript_missing',
  'x_bridge_unavailable',
  'scraper_auth_missing',
  'invalid_uri',
  'llm_inference_failed',
  'inference_unavailable'
]);

export class StagePreconditionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StagePreconditionError';
  }
}

export async function ingestSourceUri(uri, options = {}) {
  const root = options.root ?? process.cwd();
  const now = nowIso(options.now);
  let canonicalUri;
  let sourceDocId;
  try {
    canonicalUri = canonicalizeUri(uri);
    sourceDocId = sourceDocIdForUri(canonicalUri);
  } catch (error) {
    const pending = revisitPendingRecord({
      id: `source-doc:${stableHash(uri)}`,
      canonicalUri: String(uri),
      reasonCode: 'invalid_uri',
      reasonDetail: error.message,
      now
    });
    await persistRevisit(root, pending);
    return { status: 'revisit_pending', sourceDoc: pending };
  }

  const latest = await latestRecordById(root, 'source-docs', sourceDocId);
  if (latest?.status === 'parsed' && !options.force) {
    return { status: 'skipped', reason: 'already_parsed', sourceDoc: latest };
  }

  if (latest?.status === 'revisit_pending' && !options.force) {
    const resolver = await resolveRevisit(latest, { ...options, root, now });
    if (resolver.status !== 'resolved') {
      const pending = {
        ...latest,
        resolverStatus: resolver.status,
        lastCheckedAt: now,
        nextCheckAfter: nextCheckAfter(now, latest.attemptCount ?? 1),
        reasonDetail: resolver.reasonDetail ?? latest.reasonDetail
      };
      await persistRevisit(root, pending);
      return { status: 'revisit_pending', resolverStatus: resolver.status, sourceDoc: pending };
    }
  }

  try {
    const sourceDoc = await fetchAndParseSource(canonicalUri, {
      ...options,
      id: sourceDocId,
      now
    });
    await appendLedgerRecord(root, 'source-docs', sourceDoc);
    await appendRelation(root, {
      id: `relation:${sourceDoc.id}:ingested`,
      type: 'ingested',
      from: sourceDoc.id,
      to: sourceDoc.canonicalUri,
      observedAt: now
    });
    await addArtifactAndPersist(root, sourceDoc);
    return { status: 'parsed', sourceDoc };
  } catch (error) {
    const pending = revisitPendingRecord({
      id: sourceDocId,
      canonicalUri,
      reasonCode: reasonCodeForError(error),
      reasonDetail: error.message,
      now,
      previous: latest
    });
    await persistRevisit(root, pending);
    await addArtifactAndPersist(root, pending);
    return { status: 'revisit_pending', sourceDoc: pending };
  }
}

export function revisitPendingRecord({
  id,
  canonicalUri,
  reasonCode,
  reasonDetail,
  now = new Date().toISOString(),
  previous = {}
}) {
  const previousRecord = previous ?? {};
  return {
    id,
    type: 'SourceDocument',
    canonicalUri,
    status: 'revisit_pending',
    reasonCode,
    reasonDetail,
    attemptCount: Number(previousRecord.attemptCount ?? 0) + 1,
    lastAttemptAt: now,
    lastCheckedAt: now,
    nextCheckAfter: nextCheckAfter(now, Number(previousRecord.attemptCount ?? 0) + 1),
    resolverStatus: 'pending',
    observedAt: now,
    ingestedAt: now,
    textSpans: [],
    media: { images: [], videos: [] }
  };
}

export function sourceNeedsRetry(sourceDoc) {
  return sourceDoc?.status === 'revisit_pending';
}

export async function briefSourceDoc({
  root = process.cwd(),
  sourceDocId,
  inference = generateStructuredObject,
  now = new Date().toISOString()
}) {
  const sourceDoc = await latestRecordById(root, 'source-docs', sourceDocId);
  requireState(sourceDoc, 'parsed', `Cannot brief ${sourceDocId}; source document is not parsed.`);
  const graph = await loadKnowledgeGraph(root);
  const graphContext = findRelatedGraphContext(graph, {
    text: `${sourceDoc.title} ${sourceDoc.textSpans?.map((span) => span.text).join(' ')}`,
    observedAt: sourceDoc.observedAt
  });

  try {
    const result = await inference({
      task: 'source brief',
      schema: sourceBriefSchema,
      prompt: sourceBriefPrompt(sourceDoc, graphContext),
      context: { sourceDoc, graphContext }
    });
    const brief = {
      id: `source-brief:${stableHash(`${sourceDoc.id}:${sourceDoc.contentHash}:${result.model ?? result.provider}`)}`,
      type: 'Brief',
      status: 'briefed',
      sourceDocId: sourceDoc.id,
      model: result.model ?? null,
      provider: result.provider,
      promptVersion: 'source-brief-v1',
      observedAt: now,
      ...result.output
    };
    await appendLedgerRecord(root, 'source-briefs', brief);
    await appendRelation(root, relationRecord('derivedFrom', brief.id, sourceDoc.id, now));
    await addArtifactAndPersist(root, brief);
    return brief;
  } catch (error) {
    const pending = stagePendingRecord('source-brief', sourceDoc.id, error, now);
    await appendLedgerRecord(root, 'source-briefs', pending);
    await appendLedgerRecord(root, 'revisit-queue', pending);
    return pending;
  }
}

export async function enrichSourceDoc({
  root = process.cwd(),
  sourceDocId,
  inference = generateStructuredObject,
  now = new Date().toISOString()
}) {
  const sourceDoc = await latestRecordById(root, 'source-docs', sourceDocId);
  requireState(sourceDoc, 'parsed', `Cannot enrich ${sourceDocId}; source document is not parsed.`);
  const brief = await latestRecordWhere(root, 'source-briefs', (record) => record.sourceDocId === sourceDocId && record.status === 'briefed');
  requireState(brief, 'briefed', `Cannot enrich ${sourceDocId}; source brief is missing.`);
  const graph = await loadKnowledgeGraph(root);
  const graphContext = findRelatedGraphContext(graph, {
    text: `${brief.summary} ${(brief.keyPoints ?? []).join(' ')}`,
    observedAt: now
  });

  try {
    const result = await inference({
      task: 'source enrichment',
      schema: enrichedDocSchema,
      prompt: enrichPrompt(sourceDoc, brief, graphContext),
      context: { sourceDoc, brief, graphContext }
    });
    const enriched = {
      id: `enriched-doc:${stableHash(`${brief.id}:${result.model ?? result.provider}`)}`,
      type: 'EnrichedDocument',
      status: 'enriched',
      sourceDocId,
      sourceBriefId: brief.id,
      provider: result.provider,
      model: result.model ?? null,
      promptVersion: 'source-enrichment-v1',
      observedAt: now,
      ...withOpportunityIds(result.output, `enriched-doc:${stableHash(`${brief.id}:${result.model ?? result.provider}`)}`)
    };
    await appendLedgerRecord(root, 'enriched-docs', enriched);
    await appendRelation(root, relationRecord('derivedFrom', enriched.id, brief.id, now));
    await addArtifactAndPersist(root, enriched);
    return enriched;
  } catch (error) {
    const pending = stagePendingRecord('enriched-doc', sourceDoc.id, error, now);
    await appendLedgerRecord(root, 'enriched-docs', pending);
    await appendLedgerRecord(root, 'revisit-queue', pending);
    return pending;
  }
}

export async function aggregateEnrichedDocsForDate({
  root = process.cwd(),
  date = localDateForIso(new Date().toISOString()),
  inference = generateStructuredObject,
  now = new Date().toISOString()
}) {
  const enrichedDocs = (await readLedger(root, 'enriched-docs'))
    .filter((record) => record.status === 'enriched')
    .filter((record) => localDateForIso(record.observedAt ?? record.enrichedAt ?? now) === date);
  const enrichedDocIds = [...new Set(enrichedDocs.map((doc) => doc.id))];
  const selectedDocs = enrichedDocIds
    .map((id) => [...enrichedDocs].reverse().find((doc) => doc.id === id))
    .filter(Boolean);

  const graph = await loadKnowledgeGraph(root);
  const result = await inference({
    task: 'aggregate update brief',
    schema: aggregateBriefSchema,
    prompt: aggregatePrompt(date, selectedDocs, graph),
    context: { date, selectedDocs, graph: findRelatedGraphContext(graph, { text: selectedDocs.map((doc) => doc.summary ?? doc.title).join(' '), observedAt: now }) }
  });

  const aggregate = {
    id: `aggregate-brief:${date}:${stableHash(enrichedDocIds.join('|') || now)}`,
    type: 'AggregateBrief',
    status: 'aggregated',
    date,
    timezone: 'America/Chicago',
    enrichedDocIds,
    observedAt: now,
    provider: result.provider,
    model: result.model ?? null,
    promptVersion: 'aggregate-brief-v1',
    ...withOpportunityIds(result.output, `aggregate-brief:${date}`)
  };

  await appendLedgerRecord(root, 'aggregate-briefs', aggregate);
  for (const enrichedDocId of enrichedDocIds) {
    await appendRelation(root, relationRecord('derivedFrom', aggregate.id, enrichedDocId, now));
  }
  await addArtifactAndPersist(root, aggregate);
  return aggregate;
}

export async function generateArticleFromAggregate({
  root = process.cwd(),
  aggregateId,
  voice = 'tk-technews-journalist',
  inference = generateStructuredObject,
  now = new Date().toISOString(),
  evaluators = null,
  evalMode = 'live',
  maxEvalIterations = 3,
  minEvalScore = 0.86,
  linkCheck = 'syntax',
  fetchImpl = fetch
}) {
  const aggregate = await latestRecordById(root, 'aggregate-briefs', aggregateId);
  requireState(aggregate, 'aggregated', `Cannot generate article; aggregate ${aggregateId} is missing or not aggregated.`);
  const voiceProfile = await readVoiceProfile(root, voice);
  const graph = await loadKnowledgeGraph(root);
  const graphContext = findRelatedGraphContext(graph, { text: `${aggregate.title} ${aggregate.summary}`, observedAt: now });
  const allowedCitations = citationsForAggregate(aggregate);
  const result = await runGeneratedOutputLoop({
    task: 'article generation',
    outputKind: 'article',
    schema: articleSchema,
    prompt: articlePrompt(aggregate, voiceProfile, graphContext),
    context: {
      aggregate,
      voiceProfile,
      graphContext,
      allowedCitations,
      relevanceText: [
        aggregate.title,
        aggregate.summary,
        ...(aggregate.themes ?? []).flatMap((theme) => [theme.title, theme.summary])
      ].filter(Boolean).join(' ')
    },
    voiceProfile,
    inference,
    evaluators,
    evalMode,
    maxIterations: maxEvalIterations,
    minScore: minEvalScore,
    linkCheck,
    fetchImpl,
    normalizeOutput: (candidate) => {
      const citations = dedupeCitations([...(candidate.citations ?? []), ...allowedCitations]);
      return {
        ...candidate,
        citations,
        markdownBody: ensureAppliedOpportunitiesSection(candidate.markdownBody, aggregate.appliedOpportunities ?? [], citations)
      };
    }
  });

  const output = result.output;
  const slug = slugify(output.slug || output.title);
  const articleId = `article:${stableHash(`${aggregate.id}:${slug}`)}`;
  const citations = dedupeCitations([...(output.citations ?? []), ...(aggregate.citations ?? [])]);
  const markdownBody = dedupeMarkdownBody(ensureAppliedOpportunitiesSection(output.markdownBody, aggregate.appliedOpportunities ?? [], citations));
  const articlesDir = path.join(root, 'src', 'content', 'articles');
  await fs.mkdir(articlesDir, { recursive: true });
  const markdownPath = path.join(articlesDir, `${slug}.md`);
  const markdown = [
    frontmatterString({
      title: output.title,
      description: output.description,
      pubDate: now.slice(0, 10),
      sourceCount: citations.length,
      tags: output.tags ?? [],
      articleId,
      aggregateBriefId: aggregate.id,
      enrichedDocIds: aggregate.enrichedDocIds ?? [],
      voice,
      model: result.model ?? result.provider,
      evalStatus: result.evalStatus,
      evalScore: result.evalScore,
      citations
    }),
    markdownBody.trim(),
    ''
  ].join('\n');
  await fs.writeFile(markdownPath, markdown);

  const article = {
    id: articleId,
    type: 'Article',
    status: 'article_published',
    aggregateBriefId: aggregate.id,
    enrichedDocIds: aggregate.enrichedDocIds ?? [],
    voice,
    provider: result.provider,
    model: result.model ?? null,
    evalReport: result.evalReport,
    evalScore: result.evalScore,
    evalAttempts: result.evalAttempts,
    evalStatus: result.evalStatus,
    title: output.title,
    description: output.description,
    slug,
    markdownPath,
    citations,
    observedAt: now
  };
  await appendLedgerRecord(root, 'articles', article);
  await appendRelation(root, relationRecord('derivedFrom', article.id, aggregate.id, now));
  await addArtifactAndPersist(root, article);
  return article;
}

async function fetchAndParseSource(uri, { id, now, fetchImpl = fetch }) {
  const response = await fetchImpl(uri, {
    headers: {
      accept: 'text/html, application/xhtml+xml, application/xml, text/plain;q=0.8',
      'user-agent': 'tk-technews durable pipeline; local research agent'
    },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} while fetching ${uri}`);

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType && !/(text\/html|application\/xhtml\+xml|application\/xml|text\/xml|text\/plain)/i.test(contentType)) {
    throw new Error(`Unsupported content type: ${contentType}`);
  }

  const body = await response.text();
  if (!body.trim()) throw new Error('Empty response body.');

  const parsed = parseHtmlDocument(uri, body);
  if (parsed.textSpans.length === 0) throw new Error('No extractable text spans found.');

  return {
    id,
    type: 'SourceDocument',
    status: 'parsed',
    canonicalUri: uri,
    sourceType: sourceTypeForUri(uri),
    title: parsed.title,
    publisher: parsed.publisher,
    author: parsed.author,
    publishedAt: parsed.publishedAt,
    observedAt: now,
    ingestedAt: now,
    validFrom: parsed.publishedAt ?? now,
    validUntil: null,
    contentHash: stableHash(body, 32),
    textSpans: parsed.textSpans,
    media: parsed.media
  };
}

function parseHtmlDocument(uri, html) {
  const $ = cheerio.load(html);
  $('script, style, nav, footer, noscript').remove();
  const title =
    $('meta[property="og:title"]').attr('content') ??
    $('title').first().text().trim() ??
    uri;
  const publisher =
    $('meta[property="og:site_name"]').attr('content') ??
    new URL(uri).hostname.replace(/^www\./, '');
  const author =
    $('meta[name="author"]').attr('content') ??
    $('meta[property="article:author"]').attr('content') ??
    null;
  const publishedAt =
    $('meta[property="article:published_time"]').attr('content') ??
    $('time[datetime]').first().attr('datetime') ??
    null;
  const paragraphs = $('main p, article p, p')
    .map((_, paragraph) => stripHtml($(paragraph).text()))
    .get()
    .map((text) => text.replace(/\s+/g, ' ').trim())
    .filter((text) => text.length >= 24);
  const fallback = stripHtml($('main').text() || $('article').text() || $('body').text());
  const spanTexts = paragraphs.length > 0 ? paragraphs : [fallback].filter((text) => text.length >= 24);
  const textSpans = spanTexts.slice(0, 24).map((text, index) => ({
    id: `text-span:${stableHash(`${uri}:span-${index + 1}:${text}`, 20)}`,
    index: index + 1,
    text,
    citation: {
      title,
      url: `${uri}#span-${index + 1}`,
      source: publisher
    }
  }));
  const images = [
    $('meta[property="og:image"]').attr('content'),
    ...$('img[src]').map((_, image) => $(image).attr('src')).get()
  ]
    .filter(Boolean)
    .slice(0, 8)
    .map((src, index) => ({
      id: `image:${stableHash(`${uri}:image:${src}`, 20)}`,
      uri: new URL(src, uri).toString(),
      alt: index === 0 ? $('meta[property="og:image:alt"]').attr('content') ?? '' : ''
    }));
  const videos = [
    $('meta[property="og:video"]').attr('content'),
    ...$('video[src]').map((_, video) => $(video).attr('src')).get()
  ]
    .filter(Boolean)
    .slice(0, 4)
    .map((src) => ({
      id: `video:${stableHash(`${uri}:video:${src}`, 20)}`,
      uri: new URL(src, uri).toString(),
      title
    }));

  return {
    title: title.trim() || uri,
    publisher,
    author,
    publishedAt: dateToIso(publishedAt),
    textSpans,
    media: { images, videos }
  };
}

async function resolveRevisit(sourceDoc, { fetchImpl = fetch }) {
  if (sourceDoc.reasonCode === 'invalid_uri') {
    return { status: 'manual_required', reasonDetail: 'Invalid URI requires manual correction.' };
  }
  if (sourceDoc.reasonCode === 'scraper_auth_missing') {
    return process.env.FIRECRAWL_API_KEY
      ? { status: 'resolved' }
      : { status: 'still_blocked', reasonDetail: 'FIRECRAWL_API_KEY is still missing.' };
  }
  if (sourceDoc.reasonCode === 'parse_empty_text') {
    const response = await fetchImpl(sourceDoc.canonicalUri, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
    const length = Number(response.headers.get('content-length') ?? 0);
    return length > 512
      ? { status: 'resolved' }
      : { status: 'still_blocked', reasonDetail: 'Resolver did not observe enough content to justify a full parse retry.' };
  }
  if (sourceDoc.reasonCode?.startsWith('http_') || sourceDoc.reasonCode === 'empty_body' || sourceDoc.reasonCode === 'unsupported_content_type') {
    const response = await fetchImpl(sourceDoc.canonicalUri, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
    if (response.status === 404) return { status: 'manual_required', reasonDetail: 'Source still returns HTTP 404.' };
    if (response.ok) return { status: 'resolved' };
    return { status: 'still_blocked', reasonDetail: `Resolver still sees HTTP ${response.status}.` };
  }
  if (sourceDoc.reasonCode === 'youtube_transcript_missing' || sourceDoc.reasonCode === 'x_bridge_unavailable') {
    return { status: 'still_blocked', reasonDetail: `${sourceDoc.reasonCode} resolver is not resolved yet.` };
  }
  return { status: 'resolved' };
}

async function persistRevisit(root, pending) {
  await appendLedgerRecord(root, 'source-docs', pending);
  await appendLedgerRecord(root, 'revisit-queue', pending);
}

function reasonCodeForError(error) {
  const message = error.message ?? String(error);
  const http = message.match(/HTTP\s+(\d+)/i);
  if (http) {
    const status = Number(http[1]);
    if (status === 401) return 'http_401';
    if (status === 403) return 'http_403';
    if (status === 404) return 'http_404';
    if (status === 429) return 'http_429';
    if (status >= 500) return 'http_5xx';
  }
  if (/timeout|aborted/i.test(message)) return 'timeout';
  if (/empty response body/i.test(message)) return 'empty_body';
  if (/unsupported content type/i.test(message)) return 'unsupported_content_type';
  if (/no extractable text/i.test(message)) return 'parse_empty_text';
  return 'parse_empty_text';
}

function nextCheckAfter(now, attemptCount) {
  const minutes = Math.min(60 * 24, 5 * 2 ** Math.max(0, Number(attemptCount) - 1));
  return new Date(new Date(now).getTime() + minutes * 60 * 1000).toISOString();
}

function sourceTypeForUri(uri) {
  const url = new URL(uri);
  if (/youtube\.com|youtu\.be/i.test(url.hostname)) return 'youtube';
  if (/x\.com|twitter\.com/i.test(url.hostname)) return 'x';
  if (/rss|feed|xml/i.test(url.pathname)) return 'rss';
  return 'web';
}

function requireState(record, state, message) {
  if (!record || record.status !== state) throw new StagePreconditionError(message);
}

function relationRecord(type, from, to, observedAt) {
  return {
    id: `relation:${type}:${stableHash(`${from}:${to}:${observedAt}`, 20)}`,
    type,
    from,
    to,
    observedAt
  };
}

function stagePendingRecord(stage, parentId, error, now) {
  const reasonCode = error.code === 'inference_unavailable' ? 'inference_unavailable' : 'llm_inference_failed';
  return {
    id: `${stage}:pending:${stableHash(`${parentId}:${now}`)}`,
    type: stage,
    parentId,
    status: 'revisit_pending',
    reasonCode,
    reasonDetail: error.message,
    attemptCount: 1,
    lastAttemptAt: now,
    lastCheckedAt: now,
    nextCheckAfter: nextCheckAfter(now, 1),
    resolverStatus: 'pending'
  };
}

export function localDateForIso(iso, timeZone = 'America/Chicago') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(iso));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function dateToIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const citationSchema = z.object({
  title: z.string(),
  url: z.string(),
  source: z.string()
});

const appliedOpportunitySchema = z.object({
  title: z.string(),
  speculationLabel: z.literal('Speculative applied opportunity'),
  confidence: z.number().min(0).max(1),
  riskNotes: z.array(z.string()),
  evidenceIds: z.array(z.string()).default([]),
  citations: z.array(citationSchema)
});

export const sourceBriefSchema = z.object({
  summary: z.string(),
  keyPoints: z.array(z.string()),
  claims: z.array(z.object({
    text: z.string(),
    evidenceIds: z.array(z.string()),
    citations: z.array(citationSchema)
  })),
  limitations: z.array(z.string()),
  tags: z.array(z.string()).default([]),
  citations: z.array(citationSchema)
});

export const enrichedDocSchema = z.object({
  title: z.string(),
  summary: z.string(),
  entities: z.array(z.object({ name: z.string(), type: z.string().default('Entity') })),
  topics: z.array(z.string()),
  claims: z.array(z.object({
    id: z.string().optional(),
    text: z.string(),
    evidenceIds: z.array(z.string()),
    citations: z.array(citationSchema)
  })),
  events: z.array(z.object({
    title: z.string(),
    eventDate: z.string().nullable(),
    evidenceIds: z.array(z.string()),
    citations: z.array(citationSchema)
  })),
  relationships: z.array(z.object({
    type: z.string(),
    from: z.string(),
    to: z.string(),
    evidenceIds: z.array(z.string())
  })),
  appliedOpportunities: z.array(appliedOpportunitySchema),
  citations: z.array(citationSchema)
});

export const aggregateBriefSchema = z.object({
  title: z.string(),
  summary: z.string(),
  themes: z.array(z.object({
    title: z.string(),
    summary: z.string(),
    enrichedDocIds: z.array(z.string()),
    citations: z.array(citationSchema)
  })),
  appliedOpportunities: z.array(appliedOpportunitySchema).default([]),
  citations: z.array(citationSchema),
  omittedRedundancies: z.array(z.string())
});

export const articleSchema = z.object({
  title: z.string(),
  description: z.string(),
  slug: z.string(),
  tags: z.array(z.string()),
  markdownBody: z.string(),
  citations: z.array(citationSchema)
});

function sourceBriefPrompt(sourceDoc, graphContext) {
  return [
    'Create a useful cited brief for this source document.',
    'Use only source spans and graph context as evidence.',
    'Return JSON matching the schema.',
    JSON.stringify({ sourceDoc, graphContext }, null, 2)
  ].join('\n\n');
}

function enrichPrompt(sourceDoc, brief, graphContext) {
  return [
    'Enrich this source brief into temporal knowledge graph artifacts.',
    'Add entities, topics, events, claims, relationships, and speculative applied opportunities.',
    'Applied opportunities must be labeled "Speculative applied opportunity", include confidence, risk notes, evidence IDs, and citations.',
    JSON.stringify({ sourceDoc, brief, graphContext }, null, 2)
  ].join('\n\n');
}

function aggregatePrompt(date, selectedDocs, graph) {
  return [
    `Create a deduplicated daily update brief for ${date} in America/Chicago.`,
    'Use enriched documents and graph context. Preserve citations.',
    JSON.stringify({ selectedDocs, graphContext: findRelatedGraphContext(graph, { text: selectedDocs.map((doc) => doc.summary ?? doc.title).join(' ') }) }, null, 2)
  ].join('\n\n');
}

function articlePrompt(aggregate, voiceProfile, graphContext) {
  return [
    'Write a TK TechNews article from this aggregate brief.',
    'Use the article narrator voice profile. Preserve citations. Include a clearly headed "Applied Opportunities" section.',
    'The article narrator should read like technology journalism with an academic, hard-science spin: lead with the news, then explain mechanisms, constraints, measurements, and uncertainty when supported.',
    'Speculation must be labeled and grounded in cited evidence.',
    JSON.stringify({ aggregate, voiceProfile, graphContext }, null, 2)
  ].join('\n\n');
}

function withOpportunityIds(output, parentId) {
  return {
    ...output,
    appliedOpportunities: (output.appliedOpportunities ?? []).map((opportunity) => ({
      id: opportunity.id ?? `applied-opportunity:${stableHash(`${parentId}:${opportunity.title}`, 20)}`,
      type: 'AppliedOpportunity',
      ...opportunity
    })),
    claims: (output.claims ?? []).map((claim) => ({
      id: claim.id ?? `claim:${stableHash(`${parentId}:${claim.text}`, 20)}`,
      type: 'Claim',
      ...claim
    })),
    entities: (output.entities ?? []).map((entity) => ({
      id: entity.id ?? `entity:${slugify(entity.name)}`,
      type: 'Entity',
      ...entity
    }))
  };
}

function ensureAppliedOpportunitiesSection(markdownBody, opportunities, citations) {
  if (/^## Applied Opportunities/m.test(markdownBody)) return markdownBody;
  if (!opportunities.length) return `${markdownBody}\n\n## Applied Opportunities\n\nNo speculative applied opportunities were generated from the cited graph evidence.`;
  const fallbackCitation = citations[0];
  const lines = opportunities.map((opportunity) => {
    const citation = opportunity.citations?.[0] ?? fallbackCitation;
    const citationText = citation ? ` [${citation.title}](${citation.url})` : '';
    return `- ${opportunity.speculationLabel}: ${opportunity.title}. Confidence: ${Math.round(opportunity.confidence * 100)}%. Risks: ${(opportunity.riskNotes ?? []).join('; ')}.${citationText}`;
  });
  return `${markdownBody}\n\n## Applied Opportunities\n\n${lines.join('\n')}`;
}

/**
 * Removes repeated generated Markdown blocks and duplicate list items without dropping headings.
 */
export function dedupeMarkdownBody(markdownBody) {
  const seen = new Set();
  return String(markdownBody ?? '')
    .split(/\n{2,}/)
    .filter((block) => {
      const trimmed = block.trim();
      if (!trimmed) return false;
      if (/^#{1,6}\s+/m.test(trimmed)) return true;
      const key = markdownBlockKey(trimmed);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(dedupeMarkdownListLines)
    .join('\n\n');
}

function markdownBlockKey(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\]\((https?:\/\/[^)]+)\)/g, ']')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 240);
}

function dedupeMarkdownListLines(block) {
  if (!/^\s*[-*]\s+/m.test(block)) return block;
  const seen = new Set();
  return block
    .split('\n')
    .filter((line) => {
      if (!/^\s*[-*]\s+/.test(line)) return true;
      const key = markdownBlockKey(line);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join('\n');
}

async function readVoiceProfile(root, voice) {
  const profilePath = path.join(root, 'data', 'voice', `${voice}.json`);
  return JSON.parse(await fs.readFile(profilePath, 'utf8'));
}

function citationsForAggregate(aggregate) {
  return dedupeCitations([
    ...(aggregate.citations ?? []),
    ...(aggregate.themes ?? []).flatMap((theme) => theme.citations ?? []),
    ...(aggregate.appliedOpportunities ?? []).flatMap((opportunity) => opportunity.citations ?? [])
  ]);
}

function dedupeCitations(citations) {
  const seen = new Set();
  return citations.filter((citation) => {
    const key = canonicalUrlKey(citation?.url);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
