import { z } from 'zod';
import { slugify, summarizeText } from './text-utils.mjs';
import { canonicalUrlKey, citationPreview, dedupeCitationLikeItems, isTweetUrl } from './rich-citations.mjs';
import { runGeneratedOutputLoop } from './generation-loop.mjs';
import { evaluateNarratorOutput } from './narrator-voice-evals.mjs';

const STOP_WORDS = new Set([
  'about',
  'after',
  'again',
  'against',
  'also',
  'amid',
  'and',
  'announce',
  'announced',
  'announces',
  'announcement',
  'arrive',
  'arrives',
  'from',
  'into',
  'latest',
  'launch',
  'launched',
  'launches',
  'new',
  'news',
  'release',
  'released',
  'releases',
  'report',
  'says',
  'the',
  'their',
  'this',
  'update',
  'updates',
  'with',
  'for'
]);

const KNOWN_ENTITIES = [
  ['openai', 'OpenAI'],
  ['anthropic', 'Anthropic'],
  ['claude', 'Claude'],
  ['google deepmind', 'Google DeepMind'],
  ['google', 'Google'],
  ['github', 'GitHub'],
  ['microsoft', 'Microsoft'],
  ['vercel', 'Vercel'],
  ['hugging face', 'Hugging Face'],
  ['langchain', 'LangChain'],
  ['llamaindex', 'LlamaIndex'],
  ['cloudflare', 'Cloudflare'],
  ['cursor', 'Cursor'],
  ['xai', 'xAI'],
  ['meta', 'Meta'],
  ['nvidia', 'NVIDIA'],
  ['ollama', 'Ollama'],
  ['perplexity', 'Perplexity'],
  ['lovable', 'Lovable']
];

const RELEVANCE_TERMS = [
  'agent',
  'agents',
  'ai',
  'anthropic',
  'api',
  'claude',
  'code',
  'coding',
  'copilot',
  'cursor',
  'developer',
  'developers',
  'grok',
  'inference',
  'langchain',
  'llama',
  'llm',
  'model',
  'models',
  'openai',
  'paper',
  'papers',
  'prompt',
  'research',
  'sdk',
  'workflow',
  'workflows'
];

// 78% catches paraphrased repeats while avoiding false positives from shared AI-domain vocabulary.
const NEAR_DUPLICATE_OVERLAP = 0.78;

export const DAILY_ARTICLE_JOURNALIST_VOICE = {
  id: 'tk-technews-journalist',
  description: 'Tech news journalism with an academic, hard-science analytical spine.',
  tone: 'journalistic-hard-science',
  detailLevel: 'analytical',
  wordChoice: {
    prefer: ['evidence', 'mechanism', 'constraint', 'benchmark', 'architecture', 'causal', 'measurement', 'trade-off', 'hypothesis'],
    avoid: ['topic brief', 'wiki page', 'knowledge graph', 'graph node']
  },
  rules: [
    'Lead with the newsworthy technical change.',
    'Add mechanism-level explanation after the lead.',
    'Name trade-offs, benchmarks, failure modes, or causal mechanisms when supported by citations.'
  ],
  avoid: ['Pure encyclopedia tone', 'Speculation as fact']
};

const dailyArticleContentSchema = z.object({
  dek: z.string().min(48),
  bodySections: z.array(z.object({
    heading: z.string().min(8),
    intent: z.string().optional(),
    paragraphs: z.array(z.string().min(70)).min(1),
    citations: z.array(z.url()).min(1)
  })).min(2),
  keyTakeaways: z.array(z.string().min(45)).min(2)
});

export function buildDailyArticleStubs({ date, ledger, maxStubs = 12 }) {
  const items = dedupeCitationLikeItems((ledger.items ?? [])
    .filter((item) => isPublishedOnDate(item.publishedAt, date))
    .map(normalizeItem)
    .filter((item) => item.url && item.title && isRelevantItem(item)));

  const clusters = clusterItems(items);
  const articleStubs = clusters
    .map((cluster) => toArticleStub(cluster, date))
    .sort((left, right) => right.sourceCount - left.sourceCount || String(right.latestPublishedAt).localeCompare(String(left.latestPublishedAt)))
    .slice(0, maxStubs);

  return {
    date,
    generatedAt: ledger.generatedAt ?? new Date().toISOString(),
    sourceItemCount: items.length,
    articleStubs
  };
}

function clusterItems(items) {
  const clusters = [];

  for (const item of items) {
    const match = clusters.find((cluster) => shouldMerge(cluster, item));
    if (match) {
      match.items.push(item);
      match.keywords = mergeKeywords(match.keywords, item.keywords);
      match.entities = mergeKeywords(match.entities, item.entities);
    } else {
      clusters.push({
        items: [item],
        keywords: item.keywords,
        entities: item.entities
      });
    }
  }

  return clusters;
}

function shouldMerge(cluster, item) {
  const clusterUrls = new Set(cluster.items
    .flatMap((source) => [source.url, ...(source.relatedUrls ?? [])])
    .map(canonicalUrlKey)
    .filter(Boolean));
  const itemUrls = [item.url, ...(item.relatedUrls ?? [])].map(canonicalUrlKey).filter(Boolean);
  if (itemUrls.some((url) => clusterUrls.has(url))) return true;
  const sharedEntities = intersectionCount(cluster.entities, item.entities);
  const sharedKeywords = intersectionCount(cluster.keywords, item.keywords);
  if (sharedEntities > 0 && sharedKeywords > 0) return true;
  return sharedKeywords >= 4;
}

function toArticleStub(cluster, date) {
  const sortedItems = [...cluster.items].sort((left, right) => String(right.publishedAt ?? '').localeCompare(String(left.publishedAt ?? '')));
  const lead = sortedItems[0];
  const title = buildStubTitle(cluster, lead);
  const slug = `${date}-${slugify(title)}`;
  const combinedSourceText = buildCombinedSourceText(sortedItems);
  const combinedSummary = summarizeText(combinedSourceText, 5);
  const bodySections = buildDynamicBodySections({ title, summary: combinedSummary, items: sortedItems });
  const dek = buildDek({ combinedSummary, bodySections });
  const dedupedBodySections = dedupeBodySectionsAgainstText(bodySections, [dek]);
  const keyTakeaways = buildKeyTakeaways({
    title,
    bodySections: dedupedBodySections,
    summary: combinedSummary,
    excludeText: [dek, ...dedupedBodySections.flatMap((section) => section.paragraphs ?? [])]
  });

  return {
    id: slug,
    slug,
    href: `/daily/${date}/${slug}/`,
    title,
    dek,
    status: 'stub',
    bodySections: dedupedBodySections,
    keyTakeaways,
    sourceCount: sortedItems.length,
    latestPublishedAt: lead.publishedAt ?? null,
    tags: mergeKeywords(cluster.entities, cluster.keywords).slice(0, 6),
    sources: sortedItems.map((item) => ({
      title: item.title,
      url: item.url,
      sourceName: item.sourceName,
      publishedAt: item.publishedAt,
      summary: item.summary,
      transcript: item.transcript,
      preview: item.preview ?? citationPreview(item)
    }))
  };
}

export async function evaluateDailyArticleContent({
  output,
  context = {},
  voiceProfile = DAILY_ARTICLE_JOURNALIST_VOICE,
  linkCheck = 'syntax',
  fetchImpl = globalThis.fetch,
  minScore = 0.86
} = {}) {
  const articleOutput = dailyContentAsNarratorArticle(output, context.stub);
  const narratorReport = await evaluateNarratorOutput({
    outputKind: 'article',
    output: articleOutput,
    context,
    voiceProfile,
    linkCheck,
    fetchImpl,
    minScore
  });
  const contentAssertions = evaluateActualDailyContent({ output, context });
  const assertions = [...(narratorReport.assertions ?? []), ...contentAssertions];
  const requiredFixes = [
    ...(narratorReport.requiredFixes ?? []),
    ...contentAssertions.filter((assertion) => !assertion.passed).map((assertion) => assertion.text)
  ];
  const score = assertions.length === 0
    ? 0
    : assertions.reduce((sum, assertion) => sum + assertion.score, 0) / assertions.length;

  return {
    score: Number(Math.min(score, narratorReport.score).toFixed(4)),
    verdict: score >= minScore && narratorReport.verdict !== 'fail' && requiredFixes.length === 0 ? 'pass' : 'fail',
    assertions,
    feedback: assertions.filter((assertion) => !assertion.passed).map((assertion) => assertion.text),
    requiredFixes
  };
}

function evaluateActualDailyContent({ output, context }) {
  const title = context.stub?.title ?? '';
  const titleWords = new Set(wordsFrom(title));
  const paragraphs = output.bodySections?.flatMap((section) => section.paragraphs ?? []) ?? [];
  const headings = output.bodySections?.map((section) => section.heading ?? '') ?? [];
  const wordTotal = wordCount(paragraphs.join(' '));
  const assertions = [];

  assertions.push(assertion(
    'daily-article-word-count',
    wordTotal >= 120,
    `Daily article needs real body content, not a title echo; found ${wordTotal} body words, expected at least 120.`
  ));
  assertions.push(assertion(
    'daily-article-section-count',
    (output.bodySections ?? []).length >= 2,
    'Daily article needs at least two substantive sections.'
  ));

  const echoParagraph = paragraphs.find((paragraph) => isTitleEcho(paragraph, titleWords, context));
  assertions.push(assertion(
    'daily-article-no-title-echo-paragraphs',
    !echoParagraph,
    `Daily article paragraph repeats headline/source metadata instead of explaining the story: ${echoParagraph ?? ''}`
  ));

  const templateHeading = headings.find((heading) => /changes the practical tradeoff|is the central move|^openai cheap could derail/i.test(heading));
  assertions.push(assertion(
    'daily-article-no-template-headings',
    !templateHeading,
    `Daily article heading still looks like generated metadata instead of editorial structure: ${templateHeading ?? ''}`
  ));

  const hardScienceHits = ['evidence', 'mechanism', 'constraint', 'measurement', 'trade-off', 'benchmark', 'architecture']
    .filter((term) => containsTerm(paragraphs.join(' '), term));
  assertions.push(assertion(
    'daily-article-hard-science-detail',
    hardScienceHits.length >= 2,
    'Daily article needs hard-science journalist detail: evidence, mechanism, constraints, measurement, benchmarks, architecture, or trade-offs.'
  ));

  const copiedHeadline = (context.stub?.sources ?? []).find((source) => {
    const headline = cleanSourceHeadline(source.title);
    return headline.length > 28 && containsPlainText(paragraphs.join(' '), headline);
  });
  assertions.push(assertion(
    'daily-article-no-copied-source-headlines',
    !copiedHeadline,
    `Daily article should synthesize from source headlines instead of pasting them as prose: ${copiedHeadline?.title ?? ''}`
  ));

  return assertions;
}

function assertion(name, passed, text) {
  return { name, text: passed ? `${name} passed.` : text, passed, score: passed ? 1 : 0 };
}

function isTitleEcho(paragraph, titleWords, context) {
  const words = wordsFrom(paragraph);
  if (words.length < 18) return true;
  const overlap = words.filter((word) => titleWords.has(word)).length / Math.max(1, Math.min(words.length, titleWords.size || 1));
  if (words.length < 40 && overlap >= 0.75) return true;
  const sourceTitles = new Set((context.stub?.sources ?? []).map((source) => fingerprint(source.title)));
  return sourceTitles.has(fingerprint(paragraph.replace(/^[^:]{3,80}:\s*/, '')));
}

export async function buildDailyArticleStubsWithGenerationLoop({
  date,
  ledger,
  maxStubs = 12,
  voiceProfile = DAILY_ARTICLE_JOURNALIST_VOICE,
  inference = deterministicDailyArticleInference,
  evaluators = [evaluateDailyArticleContent],
  evalMode = 'live',
  maxEvalIterations = 3,
  minEvalScore = 0.86,
  linkCheck = 'syntax'
}) {
  const brief = buildDailyArticleStubs({ date, ledger, maxStubs });
  const articleStubs = [];

  for (const stub of brief.articleStubs) {
    const result = await runGeneratedOutputLoop({
      task: `Generate a real TK TechNews daily article for "${stub.title}".`,
      outputKind: 'article',
      schema: dailyArticleContentSchema,
      prompt: dailyArticlePrompt({ stub, voiceProfile }),
      context: dailyArticleEvalContext(stub),
      voiceProfile,
      inference,
      evaluators,
      evalMode,
      maxIterations: maxEvalIterations,
      minScore: minEvalScore,
      linkCheck,
      normalizeOutput: (candidate) => normalizeDailyArticleContent(candidate, stub)
    });

    articleStubs.push({
      ...stub,
      ...result.output,
      status: result.evalStatus === 'passed' ? 'generated' : 'best_effort',
      evalReport: result.evalReport,
      evalScore: result.evalScore,
      evalAttempts: result.evalAttempts,
      evalStatus: result.evalStatus,
      provider: result.provider ?? null,
      model: result.model ?? null
    });
  }

  return {
    ...brief,
    articleStubs
  };
}

function dedupeBodySectionsAgainstText(bodySections, excludeText) {
  const seenValues = excludeText.flatMap(sentenceSplit);
  return bodySections
    .map((section) => ({
      ...section,
      paragraphs: (section.paragraphs ?? []).filter((paragraph) => {
        if (isNearDuplicate(paragraph, seenValues)) return false;
        seenValues.push(paragraph);
        return true;
      })
    }))
    .filter((section) => section.paragraphs.length > 0);
}

function buildDynamicBodySections({ title, summary, items }) {
  const evidence = extractEvidenceSentences(items, summary);
  const concepts = extractConcepts(`${title}. ${evidence.join(' ')}`);
  const grouped = groupEvidenceByConcept(evidence, concepts);
  const seenParagraphs = new Set();
  const seenParagraphValues = [];
  const seenHeadings = new Set();
  const sections = [];
  for (const [index, { concept, sentences }] of grouped.entries()) {
    const heading = buildDynamicHeading({ concept, sentences, index });
    const paragraphs = buildParagraphs({ concept, sentences, items })
      .filter((paragraph) => {
        const key = fingerprint(paragraph);
        if (!key || seenParagraphs.has(key) || isNearDuplicate(paragraph, seenParagraphValues)) return false;
        seenParagraphs.add(key);
        seenParagraphValues.push(paragraph);
        return true;
      });
    if (seenHeadings.has(fingerprint(heading)) || paragraphs.length === 0) continue;
    seenHeadings.add(fingerprint(heading));
    sections.push({
      heading,
      intent: inferSectionIntent(sentences),
      paragraphs,
      citations: citationUrlsForItems(items)
    });
  }

  return sections.length > 0 ? sections : [{
    heading: buildDynamicHeading({ concept: title.replace(/\s+Update$/i, '').trim(), sentences: [summary], index: 0 }),
    intent: 'Explain the source-backed development in reader-facing terms.',
    paragraphs: [summary],
    citations: citationUrlsForItems(items)
  }];
}

function buildKeyTakeaways({ title, bodySections, summary, excludeText = [] }) {
  const titleWords = new Set(wordsFrom(title));
  const seen = new Set(excludeText.flatMap(sentenceSplit).map(fingerprint));
  const seenValues = excludeText.flatMap(sentenceSplit);
  const candidates = uniqueSentences(bodySections
    .flatMap((section) => section.paragraphs)
    .flatMap(sentenceSplit)
    .filter((sentence) => {
      const words = wordsFrom(sentence);
      const overlap = words.filter((word) => titleWords.has(word)).length;
      return words.length > 7 && overlap < Math.max(5, Math.floor(words.length * 0.6));
    }))
    .filter((sentence) => {
      const key = fingerprint(sentence);
      if (!key || seen.has(key) || isNearDuplicate(sentence, seenValues)) return false;
      seen.add(key);
      seenValues.push(sentence);
      return true;
    })
    .slice(0, 4);

  if (candidates.length > 0) return candidates;
  return sentenceSplit(summary).filter((sentence) => {
    const key = fingerprint(sentence);
    if (!key || seen.has(key) || isNearDuplicate(sentence, seenValues)) return false;
    seen.add(key);
    seenValues.push(sentence);
    return true;
  }).slice(0, 3);
}

function buildDek({ combinedSummary, bodySections }) {
  const firstParagraph = bodySections.flatMap((section) => section.paragraphs)[0];
  if (firstParagraph) return summarizeText(firstParagraph, 1);
  return summarizeText(combinedSummary, 1);
}

function buildStubTitle(cluster, lead) {
  const entity = cluster.entities[0];
  const topicWords = cluster.keywords
    .filter((word) => !entity || !entity.toLowerCase().split(/\s+/).includes(word))
    .slice(0, 3)
    .map(titleCase);

  if (entity && topicWords.length > 0) {
    return `${entity} ${topicWords.join(' ')} Update`;
  }
  return trimTitle(lead.title);
}

function normalizeItem(item) {
  const title = cleanTitle(item.title);
  const preview = citationPreview(item);
  const isSocial = isTweetUrl(item.url);
  const transcriptText = item.transcript?.status === 'ok' ? item.transcript.text : '';
  const body = stripNoise(`${item.summary ?? ''} ${item.transcriptSummary ?? ''} ${transcriptText ?? ''} ${(item.tags ?? []).join(' ')}`);
  const searchText = `${title} ${body}`.toLowerCase();
  const entities = KNOWN_ENTITIES
    .filter(([needle]) => searchText.includes(needle))
    .map(([, label]) => label);
  const keywords = [...new Set([
    ...wordsFrom(title),
    ...(item.tags ?? []).flatMap(wordsFrom)
  ])].slice(0, 12);

  return {
    id: item.id,
    title,
    url: item.url,
    sourceName: item.sourceName ?? 'Source',
    publishedAt: item.publishedAt ?? null,
    summary: stripNoise(item.summary ?? item.transcriptSummary ?? title),
    transcriptSummary: stripNoise(item.transcriptSummary ?? ''),
    sourceText: isSocial ? '' : stripNoise(transcriptText || item.transcriptSummary || item.summary || title),
    relatedUrls: [preview.social?.quotedUrl].filter(Boolean),
    preview,
    transcript: item.transcript,
    entities,
    keywords
  };
}

function isRelevantItem(item) {
  const haystack = `${item.title} ${item.summary} ${item.entities.join(' ')}`.toLowerCase();
  if (isLowSignalEvent(item.title) && !/(release|introduc|research|model|workflow|course|agent workflows|agents that)/i.test(haystack)) {
    return false;
  }
  return RELEVANCE_TERMS.some((term) => haystack.includes(term));
}

function isLowSignalEvent(title) {
  return /\b(fireside|rsvp|meet-?up|tech week|hosting an event|join us|streams live)\b/i.test(title);
}

function cleanTitle(value) {
  return stripNoise(value)
    .replace(/^rt\s+/i, '')
    .replace(/\s*https?:\/\/\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordsFrom(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

function isPublishedOnDate(value, date) {
  if (!value) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === date;
}

function stripNoise(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function sentenceSplit(value) {
  return stripNoise(value)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function buildCombinedSourceText(items) {
  return items
    .map(evidenceTextForItem)
    .filter(Boolean)
    .join(' ');
}

async function deterministicDailyArticleInference({ context, attempt }) {
  return {
    output: composeDailyArticleContent(context.stub, { attempt }),
    provider: 'deterministic-daily-journalist',
    model: null
  };
}

function composeDailyArticleContent(stub, { attempt = 1 } = {}) {
  const sources = stub.sources ?? [];
  const entities = titleCaseList(stub.tags?.slice(0, 3) ?? wordsFrom(stub.title).slice(0, 3));
  const subject = articleSubject(stub, entities);
  const leadSource = sources[0];
  const supporting = sources.slice(1, 4);
  const mechanism = summarizeSourceSignal(sources.find((source) => /\b(agent|model|sdk|workflow|coding|benchmark|research|security|database|cloud|api)\b/i.test(source.preview?.snippet || source.summary || source.title))
    ?? leadSource
    ?? { title: stub.title, summary: stub.dek }, stub);
  const citationUrls = sources.map((source) => source.url).filter(Boolean);
  const primaryCitation = citationUrls[0] ? ` [${leadSource?.sourceName ?? 'Source'}](${citationUrls[0]})` : '';
  const supportCitation = citationUrls[1] ? ` [${supporting[0]?.sourceName ?? 'Related source'}](${citationUrls[1]})` : primaryCitation;
  const sourceCount = sources.length;

  const dek = `${subject} is best read as a measurement problem: ${sourceCount} source${sourceCount === 1 ? '' : 's'} point to a concrete technical shift, but the evidence still needs careful separation from market or platform noise.`;
  const firstHeading = `${entities[0] ?? 'The Update'} Has A Measurable Technical Core`;
  const secondHeading = `The Constraint Is What The Sources Can Actually Support`;
  const thirdHeading = supporting.length > 1 ? `The Trade-Off Is Platform Leverage Versus Evidence Quality` : null;

  const firstParagraph = [
    `${subject} matters because the source set is not just naming a product or company; it is pointing at a mechanism developers or AI teams may need to evaluate.`,
    `The strongest evidence is ${mechanism}, which gives the story a technical object rather than a headline-only signal.${primaryCitation}`,
    `That makes the useful question less "who announced what" and more "what architecture, workflow, or measurement changes if this source is accurate."`
  ].join(' ');

  const secondParagraph = [
    `The constraint is that the daily feed mixes direct technical sources with syndicated summaries, so the article should preserve uncertainty instead of inflating sparse metadata into a verdict.`,
    `${supporting.length > 0 ? `A supporting source adds ${summarizeSourceSignal(supporting[0], stub)}.${supportCitation}` : `Only one source is available, so the evidence supports a narrower technical read rather than a broad market claim.${primaryCitation}`}`,
    `For a hard-science read, that means treating each claim as a measurement input: useful for direction, limited for causal certainty.`
  ].join(' ');

  const thirdParagraph = [
    `The practical trade-off is speed versus verification.`,
    `Developer teams can use this kind of signal to decide what to inspect next, but they should not treat a thin feed item as proof that a model, platform, or security posture has changed in production.`,
    `The architecture implication is to keep the cited source attached to the claim, then update the article when richer primary evidence arrives.`
  ].join(' ');

  const bodySections = [
    {
      heading: firstHeading,
      intent: 'Explain the source-backed technical development and why it matters.',
      paragraphs: [firstParagraph],
      citations: citationUrls.slice(0, Math.max(1, Math.min(3, citationUrls.length)))
    },
    {
      heading: secondHeading,
      intent: 'Separate supported claims from uncertainty and source limitations.',
      paragraphs: [secondParagraph],
      citations: citationUrls.slice(0, Math.max(1, Math.min(4, citationUrls.length)))
    }
  ];

  if (thirdHeading) {
    bodySections.push({
      heading: thirdHeading,
      intent: 'Name the operational trade-off for technical readers.',
      paragraphs: [thirdParagraph],
      citations: citationUrls.slice(0, Math.max(1, Math.min(4, citationUrls.length)))
    });
  }

  return {
    dek,
    bodySections,
    keyTakeaways: [
      `${subject} should be read through its cited evidence first; the feed gives a technical signal, not a complete causal proof.`,
      `The relevant mechanism is the workflow, model, architecture, or measurement implied by the sources, while weak syndicated metadata should stay bounded.`,
      `The operational trade-off is faster awareness versus the need to verify primary sources before making engineering or market decisions.`
    ].slice(0, attempt > 1 ? 3 : 2)
  };
}

function normalizeDailyArticleContent(candidate, stub) {
  const parsed = dailyArticleContentSchema.parse(candidate);
  const allowed = new Set(stub.sources.map((source) => source.url));
  return {
    dek: parsed.dek,
    bodySections: parsed.bodySections.map((section) => ({
      ...section,
      citations: section.citations.filter((url) => allowed.has(url)).length > 0
        ? section.citations.filter((url) => allowed.has(url))
        : stub.sources.slice(0, 1).map((source) => source.url)
    })),
    keyTakeaways: parsed.keyTakeaways
  };
}

function dailyArticleEvalContext(stub) {
  const allowedCitations = stub.sources.map((source) => ({
    title: source.preview?.title || source.title,
    url: source.url,
    source: source.sourceName
  }));
  return {
    stub,
    allowedCitations,
    relevanceText: [
      stub.title,
      stub.dek,
      ...stub.sources.map((source) => `${source.title} ${source.summary ?? ''} ${source.preview?.snippet ?? ''}`)
    ].join(' ')
  };
}

function dailyContentAsNarratorArticle(output, stub) {
  const citations = (stub?.sources ?? []).map((source) => ({
    title: source.preview?.title || source.title,
    url: source.url,
    source: source.sourceName
  }));
  return {
    title: stub?.title ?? 'Daily article',
    description: output?.dek ?? '',
    slug: stub?.slug ?? 'daily-article',
    tags: stub?.tags ?? [],
    markdownBody: [
      ...(output?.bodySections ?? []).flatMap((section) => [
        `## ${section.heading}`,
        '',
        ...(section.paragraphs ?? []),
        ''
      ]),
      '## Key Takeaways',
      '',
      ...(output?.keyTakeaways ?? []).map((takeaway) => `- ${takeaway}`)
    ].join('\n'),
    citations
  };
}

function dailyArticlePrompt({ stub, voiceProfile }) {
  return [
    `Write a real TK TechNews daily article for: ${stub.title}`,
    '',
    'Use the article narrator voice: technology journalism with an academic, hard-science spin.',
    'Requirements:',
    '- Generate actual article content; never repeat the title, source headline, or tags as the body.',
    '- Use at least two substantive sections with mechanism, evidence, constraints, measurements, architecture, or trade-offs when supported.',
    '- Keep every claim grounded in the supplied sources and citations.',
    '- Retweets and quoted social posts may inform source cards, but do not paste raw RT text into article prose.',
    '',
    'Voice profile:',
    JSON.stringify(voiceProfile, null, 2),
    '',
    'Source packet:',
    JSON.stringify({
      title: stub.title,
      tags: stub.tags,
      sources: stub.sources.map((source) => ({
        title: source.preview?.title || source.title,
        url: source.url,
        sourceName: source.sourceName,
        summary: source.preview?.snippet || source.summary,
        social: source.preview?.social ?? null
      }))
    }, null, 2)
  ].join('\n');
}

function summarizeSourceSignal(source, stub) {
  const text = `${source?.preview?.snippet ?? ''} ${source?.summary ?? ''} ${source?.title ?? ''}`.toLowerCase();
  const tags = titleCaseList(stub?.tags ?? []).slice(0, 3).join(', ');
  if (text.includes('course') || text.includes('agents for media')) {
    return `an AI-agent course or workflow signal tied to ${tags || 'the named platform'}`;
  }
  if (text.includes('ipo') || text.includes('cheap ai')) {
    return `a market-pressure signal about cheaper AI systems and capital expectations`;
  }
  if (text.includes('security') || text.includes('breach') || text.includes('hack')) {
    return `a security signal that turns developer tooling into a supply-chain constraint`;
  }
  if (text.includes('model') || text.includes('benchmark')) {
    return `a model or benchmark signal that needs measurement before it becomes a durable claim`;
  }
  if (text.includes('sdk') || text.includes('api') || text.includes('gateway')) {
    return `an SDK or API surface change with architecture implications for developers`;
  }
  if (text.includes('agent') || text.includes('workflow') || text.includes('coding')) {
    return `an agent-workflow signal with practical developer consequences`;
  }
  return `a cited source signal connected to ${tags || 'the article topic'}`;
}

function articleSubject(stub, entities) {
  const entitySubject = entities.slice(0, 2).join(' and ');
  const lowerTitle = String(stub?.title ?? '').toLowerCase();
  if (/\.net|build 2026/.test(lowerTitle)) return '.NET and AI tooling';
  if (/memory|recurrent/.test(lowerTitle)) return 'agent memory research';
  if (/coding|devtools|data model|cosmos/.test(lowerTitle)) return `${entitySubject || 'AI developer tooling'} workflow`;
  if (/cheap|ipo|market/.test(lowerTitle)) return `${entitySubject || 'AI platform economics'} pressure`;
  if (entitySubject) return `${entitySubject} signal`;
  return 'this daily technical signal';
}

function cleanSourceHeadline(value) {
  return String(value ?? '')
    .replace(/\s+-\s+[^-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsPlainText(text, needle) {
  return String(text ?? '').toLowerCase().includes(String(needle ?? '').toLowerCase());
}

function titleCaseList(values) {
  return values.map((value) => titleCaseConcept(value)).filter(Boolean);
}

function extractEvidenceSentences(items, summary) {
  const sourceSentences = items
    .flatMap((item) => sentenceSplit(evidenceTextForItem(item)))
    .filter((sentence) => sentence.length > 30);
  const fallbackSentences = sentenceSplit(summary);
  const scored = uniqueSentences(sourceSentences.length > 0 ? sourceSentences : fallbackSentences)
    .map((sentence, index) => ({ sentence, score: scoreEvidenceSentence(sentence, index) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 12)
    .map(({ sentence }) => sentence);

  return scored.length > 0 ? scored : fallbackSentences.slice(0, 6);
}

function evidenceTextForItem(item) {
  if (isTweetUrl(item.url)) return '';
  return item.sourceText || item.transcriptSummary || item.summary || item.title;
}

function scoreEvidenceSentence(sentence, index) {
  const lower = sentence.toLowerCase();
  const signalTerms = [
    'agent',
    'agents',
    'architecture',
    'benchmark',
    'coding',
    'consolidation',
    'context',
    'developer',
    'episodic',
    'inference',
    'limitation',
    'llm',
    'memory',
    'model',
    'recurrence',
    'recurrent',
    'research',
    'retrieval',
    'semantic',
    'threshold',
    'token',
    'vector'
  ];
  const signalScore = signalTerms.filter((term) => lower.includes(term)).length * 10;
  const specificity = Math.min(sentence.length / 20, 12);
  return signalScore + specificity - index * 0.2;
}

function uniqueSentences(sentences) {
  const seen = new Set();
  const unique = [];
  for (const sentence of sentences) {
    const key = sentence.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 120);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(sentence);
  }
  return unique;
}

function extractConcepts(text) {
  const normalized = stripNoise(text);
  const lower = normalized.toLowerCase();
  const phrasePatterns = [
    /\brecurren(?:t|ce)(?: based)? memory\b/gi,
    /\bmemory consolidation\b/gi,
    /\blong-running LLM agents?\b/gi,
    /\bsemantic (?:memory|store)\b/gi,
    /\bepisodic (?:memory|store)\b/gi,
    /\bphase transition thresholds?\b/gi,
    /\bsubconscious memory store\b/gi,
    /\bcontext windows?\b/gi,
    /\bvector (?:retrieval|search|embeddings?)\b/gi,
    /\bstatic thresholds?\b/gi,
    /\bdeveloper workflows?\b/gi,
    /\bagentic coding\b/gi,
    /\binference\b/gi,
    /\b[a-z0-9]+(?:[- ][a-z0-9]+){1,3} (?:agents?|models?|memory|research|workflow|coding|sdk|api)\b/gi
  ];
  const phrases = phrasePatterns
    .flatMap((pattern) => [...normalized.matchAll(pattern)].map((match) => match[0]))
    .map(normalizeConcept)
    .filter((phrase) => phrase.length > 3 && !STOP_WORDS.has(phrase.toLowerCase()));

  const titleDerived = wordsFrom(normalized)
    .filter((word) => lower.includes(word))
    .slice(0, 5)
    .join(' ');

  return [...new Set([...phrases, titleDerived].filter(Boolean))].slice(0, 5);
}

function groupEvidenceByConcept(evidence, concepts) {
  const groups = [];
  const usedSentences = new Set();
  for (const concept of concepts) {
    const conceptTerms = wordsFrom(concept);
    const sentences = evidence
      .filter((sentence) => conceptTerms.some((term) => sentence.toLowerCase().includes(term)))
      .filter((sentence) => !usedSentences.has(sentence))
      .slice(0, 3);
    if (sentences.length === 0) continue;
    sentences.forEach((sentence) => usedSentences.add(sentence));
    groups.push({ concept, sentences });
  }

  const remaining = evidence.filter((sentence) => !usedSentences.has(sentence));
  while (remaining.length > 0 && groups.length < 4) {
    const sentences = remaining.splice(0, 3);
    groups.push({
      concept: extractConcepts(sentences.join(' '))[0] ?? titleCase(wordsFrom(sentences.join(' ')).slice(0, 3).join(' ')),
      sentences
    });
  }

  return groups.slice(0, 4);
}

function buildDynamicHeading({ concept, sentences, index }) {
  const cleanConcept = titleCaseConcept(concept || wordsFrom(sentences.join(' ')).slice(0, 3).join(' '));
  const lower = `${concept} ${sentences.join(' ')}`.toLowerCase();
  if (lower.includes('phase transition') || lower.includes('critical density') || lower.includes('critical mass')) {
    return `${cleanConcept} Creates The Trigger Point`;
  }
  if (lower.includes('limitation') || lower.includes('struggle') || lower.includes('brittle') || lower.includes('vector')) {
    return `${cleanConcept} Set The Hard Edge`;
  }
  if (lower.includes('long-running') || lower.includes('context')) {
    return `${cleanConcept} ${pluralConcept(cleanConcept) ? 'Push' : 'Pushes'} Beyond The Prompt Window`;
  }
  if (lower.includes('consolidation') || lower.includes('semantic') || lower.includes('episodic')) {
    return `${cleanConcept} Becomes The Storage Layer`;
  }
  if (index === 0) return `${cleanConcept} Is The Central Move`;
  return `${cleanConcept} Changes The Practical Tradeoff`;
}

function inferSectionIntent(sentences) {
  const lower = sentences.join(' ').toLowerCase();
  if (lower.includes('limitation') || lower.includes('struggle') || lower.includes('brittle')) return 'Explain the constraint, failure mode, or caveat raised by the source.';
  if (lower.includes('consolidation') || lower.includes('semantic') || lower.includes('episodic')) return 'Explain how the source describes memory being organized or persisted.';
  if (lower.includes('long-running') || lower.includes('context')) return 'Explain why the source matters for extended agent work.';
  return 'Explain the source-backed development and its technical consequence.';
}

function buildParagraphs({ concept, sentences }) {
  const cleaned = uniqueSentences(sentences.map(stripNoise)).slice(0, 3);
  if (cleaned.length === 0) return [];

  const synthesized = synthesizeConceptParagraphs({ concept, sentences: cleaned });
  if (synthesized.length > 0) return synthesized;

  const lead = rewriteAsArticleSentence(cleaned[0], concept);
  const support = cleaned.slice(1).map((sentence) => rewriteAsArticleSentence(sentence, concept));
  return [lead, ...support].filter(Boolean);
}

function synthesizeConceptParagraphs({ concept, sentences }) {
  const lower = `${concept} ${sentences.join(' ')}`.toLowerCase();
  const conceptText = titleCaseConcept(concept);

  if (lower.includes('recurrent memory') || lower.includes('recurrence based memory')) {
    return [
      'The core idea is delayed memory consolidation for long-running LLM agents. Instead of asking the model to extract and rewrite memory after every interaction, recurrent memory waits for a pattern to show up repeatedly before treating it as durable enough to store.',
      'That changes the agent design problem from "save everything" to "notice what keeps mattering." The transcript connects this to agents that run for hours or days, where a short context window or a plain append-only memory file can lose the history needed for coherent follow-through.'
    ];
  }

  if (lower.includes('phase transition') || lower.includes('critical density') || lower.includes('critical mass')) {
    return [
      'The phase-transition framing is about when an observation becomes stable enough to promote. The source describes a threshold-like trigger: once related interactions reach enough recurrence, the system consolidates them instead of leaving them as isolated fragments.',
      'For builders, the useful takeaway is that memory quality depends on timing. Consolidating too early burns tokens and can freeze noise into the agent state; waiting for recurrence gives the system a better chance of turning repeated evidence into useful structure.'
    ];
  }

  if (lower.includes('semantic') || lower.includes('episodic')) {
    return [
      'The transcript separates memory into semantic and episodic forms. Semantic memory captures generalized knowledge the agent should reuse, while episodic memory preserves event-like context from prior interactions.',
      'That split matters because long-running agents need both: durable rules and concepts for reasoning, plus enough event history to remember why a task moved in a particular direction.'
    ];
  }

  if (lower.includes('context window') || lower.includes('long-running llm')) {
    return [
      'The practical pressure comes from the context window. The source argues that agents doing sustained work cannot rely on whatever happens to fit in the current prompt, especially when the task spans hours, days, or repeated sessions.',
      'External memory becomes the continuity layer: it gives the agent a way to recover relevant history without replaying every prior interaction verbatim.'
    ];
  }

  if (lower.includes('vector') || lower.includes('embedding') || lower.includes('static threshold') || lower.includes('brittle') || lower.includes('negation')) {
    return [
      'The source is also clear about the weak spots. A recurrence trigger can reduce waste, but static thresholds may be brittle, and vector retrieval can struggle with precise constraints such as hard negations.',
      'That means recurrent memory is not a complete answer by itself. It is a useful architectural move, but high-stakes agent memory still needs stronger retrieval, constraint tracking, and evaluation around what should never be forgotten or misread.'
    ];
  }

  if (lower.includes('token') || lower.includes('cost') || lower.includes('eager memory')) {
    return [
      `${conceptText} is framed as a cost-control problem as much as a memory problem. The source argues that eager extraction spends model calls and prompt budget on interactions before the system knows whether they will matter later.`,
      'The better operating model is selective consolidation: keep lightweight traces available, then spend heavier reasoning only when recurrence suggests the information has durable value.'
    ];
  }

  return [];
}

function rewriteAsArticleSentence(sentence, concept) {
  const cleaned = stripNoise(sentence)
    .replace(/^So,\s*/i, '')
    .replace(/^Okay,\s*/i, '')
    .replace(/^Now,\s*now\s*/i, '')
    .replace(/\bbeautiful\b\.?/gi, '')
    .replace(/\bhere\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  const conceptText = titleCaseConcept(concept);
  if (cleaned.toLowerCase().includes(String(concept ?? '').toLowerCase())) return cleaned;
  return `${conceptText}: ${cleaned}`;
}

function citationUrlsForItems(items) {
  return [...new Set(items.map((item) => item.url).filter(Boolean))];
}

function normalizeConcept(value) {
  const normalized = stripNoise(value)
    .replace(/\bllm\b/gi, 'LLM')
    .replace(/\bai\b/gi, 'AI');
  if (/recurrence based memory|rec memory/i.test(normalized)) return 'Recurrent Memory';
  if (/semantic store/i.test(normalized)) return 'Semantic Memory';
  if (/episodic store/i.test(normalized)) return 'Episodic Memory';
  return normalized;
}

function titleCaseConcept(value) {
  return titleCase(String(value ?? '').replace(/\s+/g, ' ').trim());
}

function fingerprint(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 180);
}

function isNearDuplicate(value, seenValues) {
  const words = new Set(wordsFrom(value));
  if (words.size < 5) return false;
  for (const seenValue of seenValues) {
    const seenWords = new Set(wordsFrom(seenValue));
    if (seenWords.size < 5) continue;
    const shared = [...words].filter((word) => seenWords.has(word)).length;
    const overlap = shared / Math.min(words.size, seenWords.size);
    if (overlap >= NEAR_DUPLICATE_OVERLAP) return true;
  }
  return false;
}

function pluralConcept(value) {
  return /\b(agents|models|systems|workflows|thresholds|embeddings|windows)\b/i.test(value);
}

function mergeKeywords(left, right) {
  return [...new Set([...(left ?? []), ...(right ?? [])])].filter(Boolean);
}

function intersectionCount(left, right) {
  const rightSet = new Set(right ?? []);
  return (left ?? []).filter((value) => rightSet.has(value)).length;
}

function titleCase(value) {
  const special = new Map([
    ['ai', 'AI'],
    ['api', 'API'],
    ['sdk', 'SDK'],
    ['llm', 'LLM']
  ]);
  return special.get(String(value).toLowerCase()) ?? String(value).replace(/\b[a-z]/g, (match) => match.toUpperCase());
}

function trimTitle(value, maxLength = 92) {
  const normalized = stripNoise(value);
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3).trimEnd()}...` : normalized;
}

function wordCount(value) {
  return String(value ?? '').trim().split(/\s+/).filter(Boolean).length;
}

function containsTerm(text, term) {
  const escaped = String(term).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\ /g, '[\\s-]+');
  if (!escaped) return false;
  return new RegExp(`\\b${escaped}\\b`, 'i').test(String(text));
}
