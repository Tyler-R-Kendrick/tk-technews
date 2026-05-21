import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { stableHash } from './ledger-store.mjs';
import { stripHtml } from './text-utils.mjs';
import { generateStructuredObject } from './inference.mjs';
import { runGeneratedOutputLoop } from './generation-loop.mjs';

const WIKI_CACHE_VERSION = 1;
const MAX_WEB_ENRICHMENTS = 12;
const INTERNAL_LANGUAGE_PATTERNS = [
  /\bclaim:[a-z0-9_.:-]+/i,
  /\btopic:[a-z0-9_.:-]+/i,
  /\bcommunity:[a-z0-9_.:-]+/i,
  /\bknowledge graph\b/i,
  /\bgraph\b/i,
  /\bnode\b/i,
  /\bneighborhood\b/i,
  /\btraversal\b/i
];
const NON_NAVIGABLE_TOPIC_NAMES = new Set([
  'googlenews',
  'twitter',
  'twitterfeeds',
  'youtube',
  'githuborganizations',
  'publicationfeeds',
  'publications',
  'vercelannouncements',
  'announcements'
]);

const citationSchema = z.object({
  title: z.string().min(1),
  url: z.string().min(1),
  source: z.string().min(1)
});

const citedTextSchema = z.object({
  text: z.string().min(1),
  citationUrls: z.array(z.string().min(1)).default([])
});

const sectionSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  citationUrls: z.array(z.string().min(1)).default([])
});

const openQuestionSchema = z.object({
  question: z.string().min(1),
  context: z.string().min(1),
  citationUrls: z.array(z.string().min(1)).default([])
});

const relatedTopicSchema = z.object({
  slug: z.string().min(1),
  label: z.string().min(1),
  reason: z.string().min(1)
});

const wikiPageSchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  dek: z.string().min(1),
  summary: z.string().min(1),
  status: z.enum(['generated', 'stub']).default('generated'),
  sections: z.array(sectionSchema).default([]),
  keyDevelopments: z.array(citedTextSchema).default([]),
  whyItMatters: z.string().min(1),
  openQuestions: z.array(openQuestionSchema).default([]),
  relatedTopics: z.array(relatedTopicSchema).default([]),
  citations: z.array(citationSchema).min(1),
  metadata: z.object({
    topicId: z.string().optional(),
    sourceDocIds: z.array(z.string()).default([])
  }).default({ sourceDocIds: [] })
}).superRefine((page, context) => {
  const readerFacingText = JSON.stringify({
    title: page.title,
    dek: page.dek,
    summary: page.summary,
    sections: page.sections,
    keyDevelopments: page.keyDevelopments,
    whyItMatters: page.whyItMatters,
    openQuestions: page.openQuestions,
    relatedTopics: page.relatedTopics
  });
  for (const pattern of INTERNAL_LANGUAGE_PATTERNS) {
    if (pattern.test(readerFacingText)) {
      context.addIssue({
        code: 'custom',
        message: `Reader-facing wiki content contains internal process language: ${pattern}`
      });
    }
  }
});

export const wikiSchema = z.object({
  generatedAt: z.string().min(1),
  graphHash: z.string().min(1),
  landing: z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    overview: z.string().min(1),
    featuredPageSlugs: z.array(z.string().min(1)).default([])
  }),
  pages: z.array(wikiPageSchema)
});

export function wikiCacheKey(graphHash) {
  return `tk-technews:wiki:v${WIKI_CACHE_VERSION}:${graphHash}`;
}

export function buildGraphCommunities(jsonLd = {}, { maxCommunities = 12, maxNeighbors = 16, seedTypes = null } = {}) {
  const { nodes, edges } = normalizeJsonLd(jsonLd);
  const adjacency = buildAdjacency(nodes, edges);
  const seedNodes = [...nodes.values()]
    .filter((node) => isWikiSeedNode(node, seedTypes))
    .map((node) => ({
      node,
      score: scoreSeedNode(node, adjacency.get(node.id)?.length ?? 0)
    }))
    .sort((left, right) => right.score - left.score || labelForNode(left.node).localeCompare(labelForNode(right.node)))
    .slice(0, maxCommunities)
    .map((entry) => entry.node);

  return seedNodes.map((seed) => {
    const neighborhoodNodeIds = collectNeighborhood(seed.id, adjacency, maxNeighbors);
    const neighborhoodNodes = neighborhoodNodeIds.map((id) => nodes.get(id)).filter(Boolean);
    const neighborhoodSet = new Set(neighborhoodNodeIds);
    const neighborhoodEdges = edges.filter((edge) => neighborhoodSet.has(edge.from) && neighborhoodSet.has(edge.to));
    const citations = collectCitations(neighborhoodNodes);

    return {
      id: `community:${stableHash(`${seed.id}:${neighborhoodNodeIds.join('|')}`, 16)}`,
      seedId: seed.id,
      seedType: seed.type,
      label: labelForNode(seed),
      description: descriptionForNode(seed),
      neighborhoodNodeIds,
      nodes: neighborhoodNodes.map((node) => summarizeNode(node)),
      rawNodes: neighborhoodNodes,
      edgeTypes: [...new Set(neighborhoodEdges.map((edge) => edge.type))].sort(),
      citations,
      temporalRange: temporalRangeForNodes(neighborhoodNodes)
    };
  });
}

export function buildTopicResearchPackets(communities) {
  return communities
    .filter((community) => community.seedType === 'Topic' && community.citations.length > 0)
    .map((community) => {
      const citations = community.citations.slice(0, 10);
      const claims = community.rawNodes
        .filter((node) => node.type === 'Claim' && node.text)
        .map((node) => ({
          text: cleanReaderText(node.text),
          citationUrls: citationUrlsForNode(node, citations)
        }))
        .filter((claim) => claim.text)
        .slice(0, 8);
      const sources = community.rawNodes
        .filter((node) => node.type === 'SourceDocument')
        .map((node) => ({
          title: cleanReaderText(node.title ?? labelForNode(node)),
          source: cleanReaderText(node.sourceName ?? node.source ?? 'Source'),
          kind: cleanReaderText(node.sourceKind ?? node.kind ?? ''),
          url: node.canonicalUri ?? node.url ?? node.uri,
          publishedAt: node.publishedAt ?? null,
          excerpt: cleanReaderText(firstTextSpan(node) ?? node.summary ?? node.description ?? node.title ?? '')
        }))
        .filter((source) => source.url)
        .slice(0, 8);
      const evidence = [
        ...claims.map((claim) => ({ excerpt: claim.text, citationUrls: claim.citationUrls })),
        ...sources.map((source) => ({ excerpt: source.excerpt || source.title, citationUrls: [source.url] }))
      ].filter((item) => item.excerpt).slice(0, 10);
      const entities = community.rawNodes
        .filter((node) => node.type === 'Entity' && node.name)
        .map((node) => cleanReaderText(node.name))
        .filter(Boolean)
        .slice(0, 10);

      return {
        slug: slugifyTopic(community.label),
        topic: titleCaseTopic(community.label),
        dek: `A current briefing on ${titleCaseTopic(community.label)} from the latest monitored AI sources.`,
        evidence,
        keyClaims: claims,
        entities,
        sources,
        citations
      };
    });
}

export function buildTopicWikiFromResearchPackets({ generatedAt, graphHash, packets, mode = 'generated' }) {
  const pages = hydrateRelatedTopics(packets.map((packet) => mode === 'stub' ? topicStubPage(packet) : topicGeneratedPage(packet)));
  return wikiSchema.parse({
    generatedAt,
    graphHash,
    landing: {
      title: 'AI Topic Wiki',
      description: 'Reader-facing explainers generated from the latest AI source corpus.',
      overview: pages.length > 0
        ? 'Explore current AI topics through concise explainers, cited developments, and related subject links.'
        : 'No topic briefs are available yet. Run the weekly source and topic generation pipeline to populate this index.',
      featuredPageSlugs: pages.slice(0, 12).map((page) => page.slug)
    },
    pages
  });
}

export async function generateWikiFromKnowledgeGraph({
  root = process.cwd(),
  now = new Date().toISOString(),
  inference = generateStructuredObject,
  fetchImpl = fetch,
  maxCommunities = 24,
  maxGeneratedTopics = 8,
  useInference = process.env.TK_TECHNEWS_WIKI_USE_LLM === 'true',
  voice = 'tk-technews-wiki',
  evaluators = null,
  evalMode = 'live',
  maxEvalIterations = 3,
  minEvalScore = 0.86,
  linkCheck = 'syntax'
} = {}) {
  const graph = await readGraph(root);
  const graphHash = stableHash(stableStringify(graph), 32);
  const communities = buildGraphCommunities(graph, { maxCommunities: Math.max(maxCommunities, 24), seedTypes: ['Topic'] });
  const packets = await enrichTopicResearchPackets(buildTopicResearchPackets(communities), { fetchImpl });
  const baseWiki = buildTopicWikiFromResearchPackets({ generatedAt: now, graphHash, packets, mode: useInference ? 'stub' : 'generated' });
  const voiceProfile = await readVoiceProfile(root, voice);

  const wiki = packets.length === 0
    ? emptyWiki({ generatedAt: now, graphHash })
    : useInference
      ? await generateWikiWithInference({
        packets: packets.slice(0, maxGeneratedTopics),
        graphHash,
        inference,
        now,
        baseWiki,
        voiceProfile,
        evaluators,
        evalMode,
        maxEvalIterations,
        minEvalScore,
        linkCheck,
        fetchImpl
      })
      : {
        ...baseWiki,
        provider: 'deterministic-topic-writer',
        model: null,
        evalStatus: 'passed',
        evalScore: 1,
        evalAttempts: 0,
        evalReport: {
          score: 1,
          verdict: 'pass',
          assertions: [{ name: 'deterministic-topic-writer', text: 'Deterministic wiki writer used no live narrator refinement.', passed: true, score: 1 }],
          feedback: [],
          requiredFixes: [],
          skipped: true
        }
      };

  const persisted = addCacheMetadata(wiki, { graphHash, provider: wiki.provider, model: wiki.model });
  await persistWiki(root, persisted);
  return persisted;
}

async function generateWikiWithInference({
  packets,
  graphHash,
  inference,
  now,
  baseWiki,
  voiceProfile,
  evaluators,
  evalMode,
  maxEvalIterations,
  minEvalScore,
  linkCheck,
  fetchImpl
}) {
  try {
    const generationSchema = wikiSchema.extend({
      generatedAt: z.string().min(1).optional().default(now),
      graphHash: z.string().min(1).optional().default(graphHash)
    });
    const result = await runGeneratedOutputLoop({
      task: 'Generate reader-facing AI topic explainers from research packets.',
      outputKind: 'wiki',
      schema: generationSchema,
      context: {
        generatedAt: now,
        researchPackets: packets,
        allowedCitations: packets.flatMap((packet) => packet.citations ?? []),
        relevanceText: packets.map((packet) => `${packet.topic} ${packet.evidence?.map((item) => item.excerpt).join(' ')}`).join(' ')
      },
      voiceProfile,
      prompt: topicExplainerPrompt({ generatedAt: now, packets, graphHash, voiceProfile }),
      inference,
      evaluators,
      evalMode,
      maxIterations: maxEvalIterations,
      minScore: minEvalScore,
      linkCheck,
      fetchImpl,
      normalizeOutput: (candidate) => {
        const parsed = wikiSchema.parse({
          ...candidate,
          generatedAt: now,
          graphHash
        });
        const grounded = enforceResearchGrounding(parsed, packets);
        return mergeGeneratedPagesWithStubs(baseWiki, grounded);
      }
    });
    return {
      ...result.output,
      provider: result.provider ?? null,
      model: result.model ?? null,
      evalReport: result.evalReport,
      evalScore: result.evalScore,
      evalAttempts: result.evalAttempts,
      evalStatus: result.evalStatus
    };
  } catch {
    return {
      ...baseWiki,
      provider: null,
      model: null,
      evalStatus: 'best_effort',
      evalScore: 0,
      evalAttempts: 0,
      evalReport: {
        score: 0,
        verdict: 'fail',
        assertions: [{ name: 'wiki-inference-fallback', text: 'Wiki inference failed; persisted generated stubs.', passed: false, score: 0 }],
        feedback: ['Wiki inference failed; persisted generated stubs.'],
        requiredFixes: ['Review inference provider output and retry wiki generation.']
      }
    };
  }
}

function topicExplainerPrompt({ generatedAt, packets, graphHash, voiceProfile }) {
  return [
    'Write concise, useful AI topic explainers from the supplied research packets.',
    'The audience is technical readers who want to understand what is happening, why it matters, and what to watch next.',
    'Use the wiki narrator voice profile for neutral reference tone, concise level of detail, and source-grounded word choice.',
    'Use only the supplied source excerpts, evidence notes, and citations. Do not mention how the topics were selected.',
    'Do not use internal process language in reader-facing fields, including storage structures, source-selection mechanics, relationship maps, or identifier strings.',
    'Never include internal identifiers with colon prefixes.',
    'Every key development and section should cite one or more citationUrls from the packet.',
    'Return JSON matching the schema only.',
    '',
    'Required JSON shape:',
    '{"generatedAt":"ISO string","graphHash":"graph hash","landing":{"title":"AI Topic Wiki","description":"string","overview":"string","featuredPageSlugs":["slug"]},"pages":[{"slug":"packet slug","title":"topic title","dek":"short reader-facing description","summary":"substantive overview","status":"generated","sections":[{"title":"section title","body":"prose","citationUrls":["source url"]}],"keyDevelopments":[{"text":"development","citationUrls":["source url"]}],"whyItMatters":"substantive explanation","openQuestions":[{"question":"question","context":"context","citationUrls":["source url"]}],"relatedTopics":[{"slug":"other packet slug","label":"other topic","reason":"reader-facing relationship"}],"citations":[{"title":"source title","url":"source url","source":"publisher"}]}]}',
    '',
    'Generation metadata:',
    JSON.stringify({ generatedAt, graphHash }),
    '',
    'Voice profile:',
    JSON.stringify(voiceProfile, null, 2),
    '',
    'Research packets:',
    JSON.stringify(packets, null, 2)
  ].join('\n');
}

function enforceResearchGrounding(wiki, packets) {
  const packetsBySlug = new Map(packets.map((packet) => [packet.slug, packet]));
  const pageSlugs = new Set(wiki.pages.map((page) => page.slug));
  return {
    ...wiki,
    landing: {
      ...wiki.landing,
      featuredPageSlugs: wiki.landing.featuredPageSlugs.filter((slug) => pageSlugs.has(slug))
    },
    pages: wiki.pages.map((page) => {
      const packet = packetsBySlug.get(page.slug);
      if (!packet) throw new Error(`Generated page ${page.slug} does not match a research packet.`);
      const allowedUrls = new Set(packet.citations.map((citation) => citation.url));
      const citations = page.citations.filter((citation) => allowedUrls.has(citation.url));
      if (citations.length === 0) throw new Error(`Generated page ${page.slug} has no packet citations.`);
      return {
        ...page,
        citations,
        sections: page.sections.map((section) => ({
          ...section,
          citationUrls: section.citationUrls.filter((url) => allowedUrls.has(url))
        })),
        keyDevelopments: page.keyDevelopments.map((development) => ({
          ...development,
          citationUrls: development.citationUrls.filter((url) => allowedUrls.has(url))
        })),
        openQuestions: page.openQuestions.map((question) => ({
          ...question,
          citationUrls: question.citationUrls.filter((url) => allowedUrls.has(url))
        })),
        relatedTopics: page.relatedTopics.filter((topic) => packetsBySlug.has(topic.slug)),
        metadata: {
          ...page.metadata,
          sourceDocIds: page.metadata?.sourceDocIds ?? []
        }
      };
    })
  };
}

function mergeGeneratedPagesWithStubs(baseWiki, generatedWiki) {
  const generatedBySlug = new Map(generatedWiki.pages.map((page) => [page.slug, { ...page, status: 'generated' }]));
  const mergedPages = hydrateRelatedTopics(baseWiki.pages.map((stub) => generatedBySlug.get(stub.slug) ?? stub));
  const mergedSlugs = new Set(mergedPages.map((page) => page.slug));
  return {
    ...generatedWiki,
    landing: {
      ...generatedWiki.landing,
      featuredPageSlugs: generatedWiki.landing.featuredPageSlugs.filter((slug) => mergedSlugs.has(slug))
    },
    pages: mergedPages
  };
}

function topicStubPage(packet) {
  const firstEvidence = packet.evidence[0]?.excerpt ?? `${packet.topic} is present in the current source corpus.`;
  return {
    slug: packet.slug,
    title: packet.topic,
    dek: `A topic brief for ${packet.topic} has not been generated yet.`,
    summary: `A full brief is pending. Current sources indicate: ${trimText(firstEvidence, 260)}`,
    status: 'stub',
    sections: [],
    keyDevelopments: packet.keyClaims.slice(0, 3).map((claim) => ({
      text: claim.text,
      citationUrls: claim.citationUrls
    })),
    whyItMatters: `This topic is appearing in current AI coverage and may be useful to revisit as more cited source material arrives.`,
    openQuestions: [],
    relatedTopics: [],
    citations: packet.citations,
    metadata: {
      topicId: `topic:${packet.slug}`,
      sourceDocIds: []
    }
  };
}

function topicGeneratedPage(packet) {
  const claims = selectDevelopments(packet).slice(0, 5);
  const evidence = packet.evidence.slice(0, 4);
  return {
    slug: packet.slug,
    title: packet.topic,
    dek: packet.dek,
    summary: summaryForPacket(packet, claims, evidence),
    status: 'generated',
    sections: [
      {
        title: 'What is happening',
        body: happeningBody(packet, claims, evidence),
        citationUrls: [...new Set(claims.flatMap((claim) => claim.citationUrls).filter(Boolean))].slice(0, 4)
      },
      {
        title: 'Current signals',
        body: currentSignalsBody(packet),
        citationUrls: packet.citations.slice(0, 4).map((citation) => citation.url)
      }
    ].filter((section) => section.body),
    keyDevelopments: claims.length > 0
      ? claims.map((claim) => ({ text: claim.text, citationUrls: claim.citationUrls }))
      : evidence.slice(0, 4).map((item) => ({ text: item.excerpt, citationUrls: item.citationUrls })),
    whyItMatters: whyItMattersForPacket(packet),
    openQuestions: [{
      question: `What will determine whether ${packet.topic} becomes durable?`,
      context: 'The next signal to watch is whether the cited activity turns into repeatable adoption, measurable performance gains, or clearer deployment patterns.',
      citationUrls: packet.citations.slice(0, 2).map((citation) => citation.url)
    }],
    relatedTopics: [],
    citations: packet.citations,
    metadata: {
      topicId: `topic:${packet.slug}`,
      sourceDocIds: []
    }
  };
}

function summaryForPacket(packet, developments, evidence) {
  const topic = packet.topic;
  const signals = developments.length > 0
    ? developments.map((development) => development.text).slice(0, 3)
    : evidence.map((item) => item.excerpt).filter(Boolean).slice(0, 3);
  if (signals.length === 0) {
    return `${topic} is appearing across current AI coverage, but the available corpus does not yet contain enough detail for a deeper brief.`;
  }
  return `${topic} coverage this week spans ${topicAngles(packet)}. The clearest signals are ${joinHuman(signals.map((signal) => trimText(signal, 130)))}. Together, they point to practical movement rather than abstract debate: teams are shipping tools, models, infrastructure, and research that could change how AI systems are built and used.`;
}

function happeningBody(packet, developments, evidence) {
  const signals = developments.length > 0
    ? developments.map((development) => development.text).slice(0, 4)
    : evidence.map((item) => item.excerpt).filter(Boolean).slice(0, 3);
  if (signals.length === 0) return `${packet.topic} is present in the current source corpus, but more source detail is needed for a fuller brief.`;
  return `The current source set highlights ${joinHuman(signals.map((signal) => trimText(signal, 150)))}. That mix suggests ${packet.topic} is moving through both product channels and research channels, with developers watching for usable releases rather than just announcements.`;
}

function selectDevelopments(packet) {
  const fromClaims = packet.keyClaims
    .map((claim) => ({ text: normalizeDevelopmentText(claim.text), citationUrls: claim.citationUrls }))
    .filter((claim) => isUsefulDevelopment(claim.text));
  const fromSources = packet.sources
    .map((source) => ({
      text: normalizeDevelopmentText(source.title),
      citationUrls: [source.url].filter(Boolean)
    }))
    .filter((claim) => isUsefulDevelopment(claim.text));
  return dedupeDevelopments([...fromClaims, ...fromSources]);
}

function normalizeDevelopmentText(value) {
  return cleanReaderText(value)
    .replace(/\s+[-|]\s+[^-|]{2,40}$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^([a-z])/, (match) => match.toUpperCase());
}

function isUsefulDevelopment(text) {
  if (!text || text.length < 35) return false;
  if (/^live:/i.test(text)) return false;
  if (/lets anyone create and play ai games/i.test(text)) return false;
  if (/^ai studio is the best way/i.test(text)) return false;
  if (/^congrats to /i.test(text)) return false;
  if (/star trek|stock|shares|q1 results|dies at|famous investor|quietly fighting back/i.test(text)) return false;
  if (!/(ai|model|agent|openai|anthropic|nvidia|google|microsoft|developer|coding|llm|language|research|cloud|copilot|gemini|claude|grok|hugging|vercel|lovable|deepmind|infrastructure)/i.test(text)) return false;
  if (/^\W+$/.test(text)) return false;
  return true;
}

function dedupeDevelopments(developments) {
  const seen = new Set();
  return developments.filter((development) => {
    const key = development.text.toLowerCase().slice(0, 90);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function topicAngles(packet) {
  const kinds = [...new Set(packet.sources.map((source) => source.kind).filter(Boolean))];
  if (kinds.length === 0) return 'product releases, model work, and developer adoption';
  const mapped = kinds.map((kind) => {
    if (/github/i.test(kind)) return 'open-source developer tooling';
    if (/youtube/i.test(kind)) return 'developer education and demos';
    if (/twitter/i.test(kind)) return 'real-time product chatter';
    if (/google/i.test(kind)) return 'news coverage';
    if (/publication/i.test(kind)) return 'technical analysis';
    return kind.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  });
  return joinHuman([...new Set(mapped)].slice(0, 4));
}

function currentSignalsBody(packet) {
  const sourceNames = [...new Set(packet.citations.map((citation) => citation.source).filter(Boolean))].slice(0, 4);
  const entities = packet.entities.slice(0, 5);
  const sourceText = sourceNames.length > 0 ? `Recent sources include ${joinHuman(sourceNames)}.` : '';
  const entityText = entities.length > 0 ? `The coverage connects this topic with ${joinHuman(entities)}.` : '';
  const enriched = packet.sources.map((source) => source.fetchedExcerpt).filter(Boolean).slice(0, 1)[0];
  return [sourceText, entityText, enriched ? trimText(enriched, 280) : ''].filter(Boolean).join(' ');
}

function whyItMattersForPacket(packet) {
  const topic = packet.topic;
  const entities = packet.entities.slice(0, 3);
  const entityPhrase = entities.length > 0 ? ` for teams watching ${joinHuman(entities)}` : '';
  return `${topic} matters${entityPhrase} because it can change which tools developers choose, how AI systems are evaluated, and where product teams should expect near-term platform movement.`;
}

function hydrateRelatedTopics(pages) {
  return pages.map((page) => ({
    ...page,
    relatedTopics: page.relatedTopics.length > 0
      ? page.relatedTopics
      : pages
        .filter((candidate) => candidate.slug !== page.slug)
        .map((candidate) => {
          const reason = sharedCitationReason(page, candidate) || sharedWordReason(page, candidate);
          return reason ? { slug: candidate.slug, label: candidate.title, reason } : null;
        })
        .filter(Boolean)
        .slice(0, 5)
  }));
}

function sharedCitationReason(page, candidate) {
  const urls = new Set(page.citations.map((citation) => citation.url));
  const shared = candidate.citations.find((citation) => urls.has(citation.url));
  return shared ? `Both topics cite ${shared.source}.` : '';
}

function sharedWordReason(page, candidate) {
  const left = topicWords(`${page.title} ${page.dek}`);
  const right = topicWords(`${candidate.title} ${candidate.dek}`);
  const shared = [...left].find((word) => right.has(word));
  return shared ? `Both topics discuss ${shared}.` : '';
}

function joinHuman(items) {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
}

async function enrichTopicResearchPackets(packets, { fetchImpl }) {
  let remaining = MAX_WEB_ENRICHMENTS;
  const enriched = [];
  for (const packet of packets) {
    const sources = [];
    for (const source of packet.sources.slice(0, 2)) {
      if (remaining <= 0) break;
      remaining -= 1;
      sources.push(await enrichSource(source, fetchImpl));
    }
    enriched.push({
      ...packet,
      sources: [
        ...sources,
        ...packet.sources.slice(sources.length)
      ]
    });
  }
  return enriched;
}

async function enrichSource(source, fetchImpl) {
  try {
    const response = await fetchImpl(source.url, {
      headers: {
        accept: 'text/html, text/plain;q=0.9',
        'user-agent': 'tk-technews wiki topic researcher; local research agent'
      },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return source;
    const contentType = response.headers?.get?.('content-type') ?? '';
    if (contentType && !/text\/html|text\/plain/i.test(contentType)) return source;
    const body = await response.text();
    const excerpt = summarizeExcerpt(stripHtml(body));
    return excerpt ? { ...source, fetchedExcerpt: excerpt } : source;
  } catch {
    return source;
  }
}

function summarizeExcerpt(text) {
  const normalized = cleanReaderText(text);
  if (!normalized || normalized.length < 120) return '';
  return trimText(normalized, 800);
}

function addCacheMetadata(wiki, { graphHash }) {
  const { provider, model, evalReport, evalScore, evalAttempts, evalStatus, ...wikiBody } = wiki;
  return {
    ...wikiBody,
    cache: {
      version: WIKI_CACHE_VERSION,
      key: wikiCacheKey(graphHash),
      graphHash,
      generatedBy: {
        provider: provider ?? null,
        model: model ?? null
      },
      evalReport: evalReport ?? null,
      evalScore: evalScore ?? null,
      evalAttempts: evalAttempts ?? null,
      evalStatus: evalStatus ?? null
    }
  };
}

async function persistWiki(root, wiki) {
  const srcPath = path.join(root, 'src', 'data', 'wiki', 'generated-wiki.json');
  const publicPath = path.join(root, 'public', 'wiki', 'generated-wiki.json');
  await fs.mkdir(path.dirname(srcPath), { recursive: true });
  await fs.mkdir(path.dirname(publicPath), { recursive: true });
  const json = `${JSON.stringify(wiki, null, 2)}\n`;
  await fs.writeFile(srcPath, json);
  await fs.writeFile(publicPath, json);
}

async function readGraph(root) {
  try {
    return JSON.parse(await fs.readFile(path.join(root, 'data', 'graph', 'kg.jsonld'), 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return { '@context': {}, '@graph': [] };
    throw error;
  }
}

async function readVoiceProfile(root, voice) {
  try {
    return JSON.parse(await fs.readFile(path.join(root, 'data', 'voice', `${voice}.json`), 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return fallbackVoiceProfile(voice);
  }
}

function fallbackVoiceProfile(voice) {
  if (voice === 'tk-technews-wiki') {
    return {
      id: voice,
      description: 'Neutral, compact, source-grounded wiki page narration.',
      tone: 'reference',
      detailLevel: 'concise',
      wordChoice: {
        prefer: ['definition', 'source', 'evidence', 'context', 'development'],
        avoid: ['trial', 'verdict', 'phase transition', 'first-principles']
      },
      rules: ['Use neutral reference prose.', 'Keep sections concise and cited.'],
      avoid: ['Uncited claims', 'Overly academic jargon', 'Long article-style narrative arcs']
    };
  }
  return {
    id: voice,
    description: 'Clear, cited, practical technology analysis.',
    rules: [
      'Lead with the useful change, not hype.',
      'Preserve citations for every sourced claim.',
      'Separate observed facts from speculation.'
    ],
    avoid: [
      'Uncited claims',
      'Breathless superlatives',
      'Treating speculation as fact'
    ]
  };
}

function emptyWiki({ generatedAt, graphHash }) {
  return wikiSchema.parse({
    generatedAt,
    graphHash,
    landing: {
      title: 'AI Topic Wiki',
      description: 'Reader-facing explainers generated from the latest AI source corpus.',
      overview: 'No topic briefs are available yet. Run the weekly source and topic generation pipeline to populate this index.',
      featuredPageSlugs: []
    },
    pages: []
  });
}

function normalizeJsonLd(jsonLd) {
  const nodes = new Map();
  const edges = [];
  for (const item of jsonLd?.['@graph'] ?? []) {
    const id = item['@id'] ?? item.id;
    if (!id) continue;
    const type = item['@type'] ?? item.type ?? 'Thing';
    if (item.from && item.to) {
      edges.push({ id, type, from: item.from, to: item.to });
      continue;
    }
    nodes.set(id, { ...item, id, type });
  }
  return { nodes, edges };
}

function buildAdjacency(nodes, edges) {
  const adjacency = new Map([...nodes.keys()].map((id) => [id, []]));
  for (const edge of edges) {
    if (!adjacency.has(edge.from) || !adjacency.has(edge.to)) continue;
    adjacency.get(edge.from).push({ id: edge.to, edge });
    adjacency.get(edge.to).push({ id: edge.from, edge });
  }
  for (const neighbors of adjacency.values()) {
    neighbors.sort((left, right) => left.id.localeCompare(right.id));
  }
  return adjacency;
}

function collectNeighborhood(seedId, adjacency, maxNeighbors) {
  const visited = new Set([seedId]);
  const queue = [seedId];
  while (queue.length > 0 && visited.size < maxNeighbors) {
    const currentId = queue.shift();
    for (const neighbor of adjacency.get(currentId) ?? []) {
      if (visited.has(neighbor.id)) continue;
      visited.add(neighbor.id);
      queue.push(neighbor.id);
      if (visited.size >= maxNeighbors) break;
    }
  }
  return [...visited];
}

function isWikiSeedNode(node, seedTypes = null) {
  if (node.type === 'Topic' && !isNavigableTopic(node.name)) return false;
  if (seedTypes) return seedTypes.includes(node.type);
  return ['SourceDocument', 'TextSpan', 'TranscriptSegment', 'ImageAsset', 'VideoAsset', 'Claim', 'Entity', 'Event', 'Topic', 'Brief', 'EnrichedDocument', 'AggregateBrief', 'Article', 'AppliedOpportunity'].includes(node.type);
}

function isNavigableTopic(name) {
  return !NON_NAVIGABLE_TOPIC_NAMES.has(slugifyTopic(name).replace(/-/g, ''));
}

function scoreSeedNode(node, degree) {
  let score = degree * 4;
  if (node.type === 'Topic') score += 24;
  if (['Entity', 'Claim'].includes(node.type)) score += 10;
  if (['EnrichedDocument', 'AggregateBrief', 'Article'].includes(node.type)) score += 8;
  if (collectCitations([node]).length > 0) score += 6;
  if (node.summary || node.description || node.text) score += 4;
  if (node.publishedAt || node.observedAt || node.eventDate) score += 2;
  return score;
}

function summarizeNode(node) {
  return {
    id: node.id,
    type: node.type,
    label: labelForNode(node),
    description: descriptionForNode(node),
    temporal: {
      publishedAt: node.publishedAt ?? null,
      observedAt: node.observedAt ?? null,
      validFrom: node.validFrom ?? null,
      validUntil: node.validUntil ?? null,
      eventDate: node.eventDate ?? null,
      ingestedAt: node.ingestedAt ?? null
    }
  };
}

function labelForNode(node) {
  return trimText(node.name ?? node.title ?? node.headline ?? node.label ?? node.text ?? node.summary ?? node.id, 96);
}

function descriptionForNode(node) {
  return trimText(node.description ?? node.summary ?? node.text ?? node.canonicalUri ?? node.url ?? node.uri ?? '', 280);
}

function collectCitations(nodes) {
  const citations = new Map();
  for (const node of nodes) {
    for (const citation of node.citations ?? []) {
      addCitation(citations, {
        title: citation.title ?? citation.source ?? labelForNode(node),
        url: citation.url ?? citation.uri,
        source: citation.source ?? node.source ?? node.sourceName ?? node.type
      });
    }
    addCitation(citations, {
      title: node.title ?? node.name ?? node.source ?? labelForNode(node),
      url: node.canonicalUri ?? node.url ?? node.uri,
      source: node.source ?? node.sourceName ?? node.type
    });
  }
  return [...citations.values()];
}

function addCitation(citations, citation) {
  if (!citation.url) return;
  const key = String(citation.url);
  if (citations.has(key)) return;
  citations.set(key, {
    title: trimText(cleanReaderText(citation.title), 140),
    url: key,
    source: trimText(cleanReaderText(citation.source), 96)
  });
}

function citationUrlsForNode(node, fallbackCitations) {
  const urls = (node.citations ?? []).map((citation) => citation.url).filter(Boolean);
  return urls.length > 0 ? urls : fallbackCitations.slice(0, 1).map((citation) => citation.url);
}

function firstTextSpan(node) {
  return (node.textSpans ?? []).map((span) => span.text).filter(Boolean).join(' ');
}

function temporalRangeForNodes(nodes) {
  const dates = nodes
    .flatMap((node) => [node.publishedAt, node.observedAt, node.validFrom, node.validUntil, node.eventDate, node.ingestedAt])
    .filter(Boolean)
    .map((value) => new Date(value).toISOString())
    .sort();
  return { start: dates[0] ?? null, end: dates.at(-1) ?? null };
}

function topicWords(value) {
  return new Set(String(value).toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3 && !['topic', 'brief', 'current'].includes(word)));
}

function cleanReaderText(value) {
  return String(value ?? '')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\b(?:claim|topic|community|source-doc):[a-z0-9_.:-]+/gi, ' ')
    .replace(/\bknowledge graph\b/gi, 'source corpus')
    .replace(/\bgraph\b/gi, 'source corpus')
    .replace(/\bnode\b/gi, 'source')
    .replace(/\bneighborhood\b/gi, 'topic area')
    .replace(/\btraversal\b/gi, 'research')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\.([A-Z])/g, '. $1')
    .replace(/\bOpen AI\b/g, 'OpenAI')
    .replace(/\bGit Hub\b/g, 'GitHub')
    .replace(/\bDeep Mind\b/g, 'DeepMind')
    .replace(/\bx AI\b/g, 'xAI')
    .replace(/\s+/g, ' ')
    .trim();
}

function trimText(value, maxLength) {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function slugifyTopic(value) {
  return String(value).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'topic';
}

function titleCaseTopic(value) {
  const normalized = String(value).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  const acronyms = new Map([
    ['ai', 'AI'],
    ['xai', 'xAI'],
    ['openai', 'OpenAI'],
    ['github', 'GitHub']
  ]);
  return normalized
    .split(' ')
    .map((word) => acronyms.get(word.toLowerCase()) ?? word.replace(/\b([a-z])/, (match) => match.toUpperCase()))
    .join(' ');
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
