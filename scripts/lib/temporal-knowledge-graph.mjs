import fs from 'node:fs/promises';
import path from 'node:path';

export const GRAPH_CONTEXT = {
  '@vocab': 'https://tk.technews.local/kg#',
  cites: { '@type': '@id' },
  derivedFrom: { '@type': '@id' },
  mentions: { '@type': '@id' },
  supportsClaim: { '@type': '@id' },
  contradictsClaim: { '@type': '@id' },
  coOccursWith: { '@type': '@id' },
  updates: { '@type': '@id' },
  sameAs: { '@type': '@id' },
  hasModality: { '@type': '@id' },
  hasTemporalScope: { '@type': '@id' },
  suggestsOpportunity: { '@type': '@id' }
};

export function graphFromRecords(records = []) {
  const graph = { nodes: new Map(), edges: new Map() };
  for (const record of records) {
    addArtifactToGraph(graph, record);
  }
  return graph;
}

export function addArtifactToGraph(graph, artifact) {
  if (!artifact) return graph;
  const type = artifact.type ?? typeForArtifact(artifact);
  addNode(graph, {
    ...artifact,
    type
  });

  if (type === 'SourceDocument') {
    addTemporalScope(graph, artifact);
    for (const span of artifact.textSpans ?? []) {
      addNode(graph, { ...span, type: 'TextSpan', sourceDocId: artifact.id });
      addEdge(graph, 'derivedFrom', span.id, artifact.id);
      addEdge(graph, 'cites', span.id, artifact.id);
    }
    for (const image of artifact.media?.images ?? []) {
      addNode(graph, { ...image, type: 'ImageAsset', sourceDocId: artifact.id });
      addEdge(graph, 'hasModality', artifact.id, image.id);
    }
    for (const video of artifact.media?.videos ?? []) {
      addNode(graph, { ...video, type: 'VideoAsset', sourceDocId: artifact.id });
      addEdge(graph, 'hasModality', artifact.id, video.id);
    }
    for (const segment of artifact.transcriptSegments ?? []) {
      addNode(graph, { ...segment, type: 'TranscriptSegment', sourceDocId: artifact.id });
      addEdge(graph, 'derivedFrom', segment.id, artifact.id);
      addEdge(graph, 'hasModality', artifact.id, segment.id);
    }
  }

  if (artifact.sourceDocId) addEdge(graph, 'derivedFrom', artifact.id, artifact.sourceDocId);
  if (artifact.sourceBriefId) addEdge(graph, 'derivedFrom', artifact.id, artifact.sourceBriefId);
  if (artifact.aggregateBriefId) addEdge(graph, 'derivedFrom', artifact.id, artifact.aggregateBriefId);

  for (const enrichedDocId of artifact.enrichedDocIds ?? []) {
    addEdge(graph, 'derivedFrom', artifact.id, enrichedDocId);
  }
  for (const evidenceId of artifact.evidenceIds ?? []) {
    addEdge(graph, 'cites', artifact.id, evidenceId);
  }
  for (const opportunity of artifact.appliedOpportunities ?? []) {
    addArtifactToGraph(graph, {
      ...opportunity,
      id: opportunity.id ?? `applied-opportunity:${artifact.id}:${slugLike(opportunity.title)}`,
      type: 'AppliedOpportunity',
      derivedFromId: artifact.id
    });
    addEdge(graph, 'suggestsOpportunity', artifact.id, opportunity.id ?? `applied-opportunity:${artifact.id}:${slugLike(opportunity.title)}`);
  }

  return graph;
}

export function addNode(graph, node) {
  const id = node.id ?? node['@id'];
  if (!id) return;
  graph.nodes.set(id, {
    ...graph.nodes.get(id),
    ...node,
    id,
    type: node.type ?? node['@type'] ?? 'Thing'
  });
}

export function addEdge(graph, type, from, to, extra = {}) {
  if (!from || !to) return;
  const id = `${type}:${from}->${to}`;
  graph.edges.set(id, { id, type, from, to, ...extra });
}

export function toJsonLd(graph) {
  return {
    '@context': GRAPH_CONTEXT,
    '@graph': [
      ...[...graph.nodes.values()].map((node) => {
        const { id, type, ...rest } = node;
        return {
          '@id': id,
          '@type': type,
          ...rest
        };
      }),
      ...[...graph.edges.values()].map((edge) => {
        const { id, type, ...rest } = edge;
        return {
          '@id': id,
          '@type': type,
          ...rest
        };
      })
    ]
  };
}

export async function loadKnowledgeGraph(root) {
  try {
    const json = JSON.parse(await fs.readFile(graphPath(root), 'utf8'));
    return graphFromJsonLd(json);
  } catch (error) {
    if (error?.code === 'ENOENT') return graphFromRecords([]);
    throw error;
  }
}

export async function persistKnowledgeGraph(root, graph) {
  await fs.mkdir(path.join(root, 'data', 'graph'), { recursive: true });
  await fs.writeFile(graphPath(root), `${JSON.stringify(toJsonLd(graph), null, 2)}\n`);
}

export async function persistArtifactJsonLd(root, artifact, graph = graphFromRecords([artifact])) {
  await fs.mkdir(path.join(root, 'data', 'rdf'), { recursive: true });
  const filePath = path.join(root, 'data', 'rdf', `${safeFileName(artifact.id)}.jsonld`);
  await fs.writeFile(filePath, `${JSON.stringify(toJsonLd(graph), null, 2)}\n`);
  return filePath;
}

export async function addArtifactAndPersist(root, artifact) {
  const graph = await loadKnowledgeGraph(root);
  addArtifactToGraph(graph, artifact);
  await persistKnowledgeGraph(root, graph);
  await persistArtifactJsonLd(root, artifact, graphFromRecords([artifact]));
  return graph;
}

export function findRelatedGraphContext(graph, { text = '', observedAt = null, limit = 8 } = {}) {
  const tokens = new Set(keywordTokens(text));
  const nodes = [...graph.nodes.values()];
  const scored = nodes
    .map((node) => ({ node, score: scoreNode(node, tokens, observedAt) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit * 3)
    .map((entry) => entry.node);

  return {
    entities: scored.filter((node) => node.type === 'Entity').slice(0, limit),
    claims: scored.filter((node) => node.type === 'Claim').slice(0, limit),
    topics: scored.filter((node) => node.type === 'Topic').slice(0, limit),
    temporalNeighbors: scored
      .filter((node) => node.observedAt || node.publishedAt || node.eventDate)
      .slice(0, limit)
  };
}

function graphFromJsonLd(json) {
  const graph = graphFromRecords([]);
  for (const item of json['@graph'] ?? []) {
    if (item.from && item.to) {
      graph.edges.set(item['@id'], {
        id: item['@id'],
        type: item['@type'],
        ...withoutJsonLd(item)
      });
    } else {
      graph.nodes.set(item['@id'], {
        id: item['@id'],
        type: item['@type'],
        ...withoutJsonLd(item)
      });
    }
  }
  return graph;
}

function withoutJsonLd(item) {
  const copy = { ...item };
  delete copy['@id'];
  delete copy['@type'];
  return copy;
}

function addTemporalScope(graph, artifact) {
  const temporalId = `${artifact.id}:temporal-scope`;
  addNode(graph, {
    id: temporalId,
    type: 'TemporalScope',
    publishedAt: artifact.publishedAt ?? null,
    observedAt: artifact.observedAt ?? null,
    validFrom: artifact.validFrom ?? artifact.publishedAt ?? artifact.observedAt ?? null,
    validUntil: artifact.validUntil ?? null,
    eventDate: artifact.eventDate ?? null,
    ingestedAt: artifact.ingestedAt ?? null,
    supersedes: artifact.supersedes ?? null
  });
  addEdge(graph, 'hasTemporalScope', artifact.id, temporalId);
}

function typeForArtifact(artifact) {
  if (artifact.canonicalUri) return 'SourceDocument';
  if (artifact.sourceDocId && artifact.summary) return 'Brief';
  if (artifact.sourceBriefId) return 'EnrichedDocument';
  if (artifact.enrichedDocIds) return 'AggregateBrief';
  if (artifact.markdownPath) return 'Article';
  return artifact.type ?? 'Thing';
}

function scoreNode(node, tokens, observedAt) {
  const haystack = keywordTokens([
    node.name,
    node.title,
    node.text,
    node.summary,
    ...(node.entities ?? []),
    ...(node.topics ?? [])
  ].filter(Boolean).join(' '));
  let score = haystack.filter((token) => tokens.has(token)).length;
  if (score > 0 && observedAt && (node.observedAt || node.publishedAt || node.eventDate)) {
    const delta = Math.abs(new Date(observedAt).getTime() - new Date(node.observedAt ?? node.publishedAt ?? node.eventDate).getTime());
    if (delta < 3 * 24 * 60 * 60 * 1000) score += 1;
  }
  return score;
}

function keywordTokens(text) {
  return String(text)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .split(/[^a-z0-9+#.-]+/)
    .filter((token) => token.length > 2);
}

function graphPath(root) {
  return path.join(root, 'data', 'graph', 'kg.jsonld');
}

function safeFileName(id) {
  return String(id).replace(/[^a-z0-9_.-]+/gi, '-').replace(/^-+|-+$/g, '');
}

function slugLike(value = '') {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'untitled';
}
