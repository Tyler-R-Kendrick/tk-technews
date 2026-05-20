const STOP_ENTITIES = new Set([
  'The',
  'This',
  'That',
  'First',
  'Second',
  'Third',
  'Fourth',
  'Source',
  'Example',
  'Developers',
  'Article URL',
  'Comments URL',
  'Comments',
  'Points'
]);

export function extractKnowledgeModel(ledger, options = {}) {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const maxClaimsPerSource = Number(options.maxClaimsPerSource ?? 4);
  const okItems = (ledger.items ?? []).filter((item) => item.status === 'ok');
  const sources = okItems.map(toKnowledgeSource);
  const claims = okItems.flatMap((item) => extractClaims(item, maxClaimsPerSource));
  const entities = extractEntities(okItems);
  const topics = extractTopics(okItems);
  const relationships = extractRelationships(okItems);

  return {
    generatedAt,
    sourceCount: sources.length,
    sources,
    topics,
    entities,
    claims,
    relationships
  };
}

function toKnowledgeSource(item) {
  return {
    id: item.id,
    title: item.title,
    sourceName: item.sourceName,
    kind: item.kind ?? 'unknown',
    url: item.url,
    publishedAt: item.publishedAt ?? null,
    fetchedAt: item.fetchedAt ?? null,
    tags: item.tags ?? []
  };
}

function extractClaims(item, maxClaimsPerSource) {
  return sentenceSplit(item.summary)
    .slice(0, maxClaimsPerSource)
    .map((text, index) => ({
      id: `${item.id}:claim-${index + 1}`,
      text,
      evidenceId: item.id,
      citation: {
        title: item.title,
        source: item.sourceName,
        url: item.url
      },
      tags: item.tags ?? []
    }));
}

function extractEntities(items) {
  const entities = new Map();

  for (const item of items) {
    const candidates = [
      ...entityCandidates(item.title),
      ...entityCandidates(item.summary)
    ];

    for (const name of candidates) {
      const current = entities.get(name) ?? {
        name,
        mentions: 0,
        evidenceIds: new Set(),
        citations: new Map()
      };
      current.mentions += 1;
      current.evidenceIds.add(item.id);
      current.citations.set(item.url, {
        title: item.title,
        source: item.sourceName,
        url: item.url
      });
      entities.set(name, current);
    }
  }

  return [...entities.values()]
    .map((entity) => ({
      name: entity.name,
      mentions: entity.mentions,
      evidenceIds: [...entity.evidenceIds],
      citations: [...entity.citations.values()]
    }))
    .sort((a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name));
}

function extractTopics(items) {
  const topics = new Map();

  for (const item of items) {
    for (const tag of item.tags ?? []) {
      const current = topics.get(tag) ?? {
        name: tag,
        evidenceIds: new Set(),
        citations: new Map()
      };
      current.evidenceIds.add(item.id);
      current.citations.set(item.url, {
        title: item.title,
        source: item.sourceName,
        url: item.url
      });
      topics.set(tag, current);
    }
  }

  return [...topics.values()]
    .map((topic) => ({
      name: topic.name,
      evidenceIds: [...topic.evidenceIds],
      citations: [...topic.citations.values()]
    }))
    .sort((a, b) => b.evidenceIds.length - a.evidenceIds.length || a.name.localeCompare(b.name));
}

function extractRelationships(items) {
  const relationships = new Map();

  for (const item of items) {
    const names = [...new Set([
      ...entityCandidates(item.title),
      ...entityCandidates(item.summary)
    ])].slice(0, 8);

    for (let left = 0; left < names.length; left += 1) {
      for (let right = left + 1; right < names.length; right += 1) {
        const pair = [names[left], names[right]].sort();
        const key = pair.join('::');
        const current = relationships.get(key) ?? {
          entities: pair,
          evidenceIds: new Set(),
          citations: new Map()
        };
        current.evidenceIds.add(item.id);
        current.citations.set(item.url, {
          title: item.title,
          source: item.sourceName,
          url: item.url
        });
        relationships.set(key, current);
      }
    }
  }

  return [...relationships.values()]
    .map((relationship) => ({
      type: 'co-mentioned',
      entities: relationship.entities,
      evidenceIds: [...relationship.evidenceIds],
      citations: [...relationship.citations.values()]
    }))
    .sort((a, b) => b.evidenceIds.length - a.evidenceIds.length || a.entities.join(' ').localeCompare(b.entities.join(' ')));
}

function entityCandidates(text = '') {
  const cleaned = String(text)
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\b(?:Article URL|Comments URL|Points|# Comments):/g, ' ');
  const matches = cleaned.match(/\b(?:[A-Z][A-Za-z0-9+.-]*(?:\s+[A-Z][A-Za-z0-9+.-]*){0,3})\b/g) ?? [];
  return matches
    .map((match) => match.trim())
    .filter((match) => match.length > 2)
    .filter((match) => !STOP_ENTITIES.has(match))
    .filter((match) => !/^\d/.test(match));
}

function sentenceSplit(text = '') {
  return String(text)
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}
