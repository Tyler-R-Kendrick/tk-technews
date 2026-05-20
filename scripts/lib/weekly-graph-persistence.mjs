import fs from 'node:fs/promises';
import path from 'node:path';
import {
  appendLedgerRecord,
  appendRelation,
  latestRecordById,
  readLedger,
  stableHash
} from './ledger-store.mjs';
import { slugify } from './text-utils.mjs';
import {
  addEdge,
  addNode,
  graphFromRecords,
  persistKnowledgeGraph
} from './temporal-knowledge-graph.mjs';

export async function persistWeeklyLedgerToKnowledgeGraph({
  root = process.cwd(),
  summariesPath = path.join(root, 'data', 'summaries', 'latest.json'),
  knowledgePath = path.join(root, 'data', 'knowledge', 'latest.json'),
  now = new Date().toISOString()
} = {}) {
  const ledger = JSON.parse(await fs.readFile(summariesPath, 'utf8'));
  const knowledge = JSON.parse(await fs.readFile(knowledgePath, 'utf8'));
  const sourceDocs = (ledger.items ?? [])
    .filter((item) => item.status === 'ok')
    .map((item) => sourceDocFromSummary(item, now));

  for (const sourceDoc of sourceDocs) {
    const latest = await latestRecordById(root, 'source-docs', sourceDoc.id);
    if (latest?.contentHash === sourceDoc.contentHash && latest?.status === 'parsed') continue;
    await appendLedgerRecord(root, 'source-docs', sourceDoc);
    await appendRelation(root, {
      id: `relation:${sourceDoc.id}:weekly-ledger`,
      type: 'derivedFrom',
      from: sourceDoc.id,
      to: sourceDoc.sourceSummaryId,
      observedAt: now
    });
  }

  const graph = graphFromRecords(sourceDocs);
  const sourceDocBySummaryId = new Map(sourceDocs.map((doc) => [doc.sourceSummaryId, doc]));

  const claims = addClaims(graph, knowledge.claims ?? [], sourceDocBySummaryId);
  const entities = addEntities(graph, knowledge.entities ?? [], sourceDocBySummaryId);
  const topics = addTopics(graph, knowledge.topics ?? [], sourceDocBySummaryId);
  const relationships = addRelationships(graph, knowledge.relationships ?? []);

  await persistKnowledgeGraph(root, graph);
  await persistGraphImportRecord(root, {
    id: `graph-import:${stableHash(`${ledger.generatedAt}:${sourceDocs.length}:${claims}:${entities}:${topics}:${relationships}`, 20)}`,
    type: 'WeeklyGraphImport',
    status: 'parsed',
    observedAt: now,
    ledgerGeneratedAt: ledger.generatedAt ?? null,
    sourceDocs: sourceDocs.length,
    claims,
    entities,
    topics,
    relationships
  });

  return {
    sourceDocs: sourceDocs.length,
    claims,
    entities,
    topics,
    relationships
  };
}

function sourceDocFromSummary(item, now) {
  const citationUrl = item.url;
  const text = item.summary || item.title;
  const id = `source-doc:${stableHash(citationUrl || item.id, 20)}`;
  return {
    id,
    type: 'SourceDocument',
    sourceSummaryId: item.id,
    canonicalUri: citationUrl,
    status: 'parsed',
    title: item.title,
    sourceName: item.sourceName,
    sourceKind: item.kind,
    publishedAt: item.publishedAt ?? null,
    observedAt: item.fetchedAt ?? now,
    ingestedAt: now,
    contentHash: stableHash(`${item.title}\n${text}`, 32),
    tags: item.tags ?? [],
    textSpans: [{
      id: `${id}:span-1`,
      type: 'TextSpan',
      text,
      startOffset: 0,
      endOffset: text.length,
      citation: {
        title: item.title,
        source: item.sourceName,
        url: citationUrl
      }
    }],
    transcriptSegments: [],
    media: { images: [], videos: [] },
    citations: [{
      title: item.title,
      source: item.sourceName,
      url: citationUrl
    }]
  };
}

function addClaims(graph, claims, sourceDocBySummaryId) {
  let count = 0;
  for (const claim of claims) {
    const sourceDoc = sourceDocBySummaryId.get(claim.evidenceId);
    if (!sourceDoc) continue;
    const id = `claim:${stableHash(claim.id ?? claim.text, 20)}`;
    addNode(graph, {
      id,
      type: 'Claim',
      text: claim.text,
      sourceDocId: sourceDoc.id,
      evidenceIds: [sourceDoc.id],
      tags: claim.tags ?? [],
      citations: [claim.citation ?? sourceDoc.citations[0]].filter(Boolean),
      observedAt: sourceDoc.observedAt,
      publishedAt: sourceDoc.publishedAt
    });
    addEdge(graph, 'derivedFrom', id, sourceDoc.id);
    addEdge(graph, 'supportsClaim', sourceDoc.id, id);
    for (const tag of claim.tags ?? []) {
      addEdge(graph, 'supportsClaim', topicId(tag), id);
    }
    count += 1;
  }
  return count;
}

function addEntities(graph, entities, sourceDocBySummaryId) {
  let count = 0;
  for (const entity of entities) {
    const evidenceDocs = (entity.evidenceIds ?? [])
      .map((id) => sourceDocBySummaryId.get(id))
      .filter(Boolean);
    if (evidenceDocs.length === 0) continue;
    const id = entityId(entity.name);
    addNode(graph, {
      id,
      type: 'Entity',
      name: entity.name,
      mentions: entity.mentions ?? evidenceDocs.length,
      evidenceIds: evidenceDocs.map((doc) => doc.id),
      citations: entity.citations ?? evidenceDocs.flatMap((doc) => doc.citations)
    });
    for (const doc of evidenceDocs) {
      addEdge(graph, 'mentions', doc.id, id);
    }
    count += 1;
  }
  return count;
}

function addTopics(graph, topics, sourceDocBySummaryId) {
  let count = 0;
  for (const topic of topics) {
    const evidenceDocs = (topic.evidenceIds ?? [])
      .map((id) => sourceDocBySummaryId.get(id))
      .filter(Boolean);
    if (evidenceDocs.length === 0) continue;
    const id = topicId(topic.name);
    addNode(graph, {
      id,
      type: 'Topic',
      name: topic.name,
      evidenceIds: evidenceDocs.map((doc) => doc.id),
      citations: topic.citations ?? evidenceDocs.flatMap((doc) => doc.citations)
    });
    for (const doc of evidenceDocs) {
      addEdge(graph, 'mentions', doc.id, id);
    }
    count += 1;
  }
  return count;
}

function addRelationships(graph, relationships) {
  let count = 0;
  for (const relationship of relationships) {
    const [left, right] = relationship.entities ?? [];
    if (!left || !right) continue;
    addEdge(graph, 'coOccursWith', entityId(left), entityId(right), {
      evidenceIds: relationship.evidenceIds ?? [],
      citations: relationship.citations ?? []
    });
    count += 1;
  }
  return count;
}

async function persistGraphImportRecord(root, record) {
  const existing = await readLedger(root, 'graph-imports');
  if (existing.some((entry) => entry.id === record.id)) return;
  await appendLedgerRecord(root, 'graph-imports', record);
}

function entityId(name) {
  return `entity:${slugify(name)}`;
}

function topicId(name) {
  return `topic:${slugify(name)}`;
}
