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
const UNUSABLE_SOURCE_TEXT_PATTERN = /\b(no usable text was extracted|no usable text|transcript unavailable|source text unavailable|could not extract usable text)\b/i;
const ARTICLE_META_PATTERNS = [
  /\bsource set\b/i,
  /\bdaily feed\b/i,
  /\bcited source signal\b/i,
  /\bsource signal\b/i,
  /\bif this source is accurate\b/i,
  /\bthe article should\b/i,
  /\bhard-science read\b/i,
  /\bmeasurement input\b/i,
  /\bmarket or platform noise\b/i,
  /\bsparse metadata\b/i,
  /\bheadline-only signal\b/i,
  /\bweak syndicated metadata\b/i
];

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
  const generatedText = readerFacingArticleText(output);
  const sourceEvidenceText = context.sourceEvidenceText ?? sourceEvidenceTextForSources(context.stub?.sources ?? []);
  const sourceEvidenceTerms = groundingTermsFromText(sourceEvidenceText);
  const generatedTerms = new Set(groundingTermsFromText(generatedText));
  const sourceTermHits = sourceEvidenceTerms.filter((term) => generatedTerms.has(term));
  const minimumSourceHits = Math.min(4, Math.max(2, Math.ceil(sourceEvidenceTerms.length * 0.2)));
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

  const metaPattern = ARTICLE_META_PATTERNS.find((pattern) => pattern.test(generatedText));
  assertions.push(assertion(
    'daily-article-no-generation-instructions',
    !metaPattern,
    'Daily article must explain the cited sources, not its generation instructions, feed mechanics, source metadata, or uncertainty policy.'
  ));

  assertions.push(assertion(
    'daily-article-has-usable-source-evidence',
    sourceEvidenceTerms.length > 0,
    'Daily article cannot pass without usable extracted source text, article excerpts, transcript summaries, or social post text.'
  ));

  assertions.push(assertion(
    'daily-article-grounded-in-source-terms',
    sourceEvidenceTerms.length === 0 || sourceTermHits.length >= minimumSourceHits,
    `Daily article must be grounded in terms from usable source evidence; matched ${sourceTermHits.length}/${sourceEvidenceTerms.length} source terms.`
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

function readerFacingArticleText(output) {
  return [
    output?.dek,
    ...(output?.bodySections ?? []).flatMap((section) => [
      section.heading,
      ...(section.paragraphs ?? [])
    ]),
    ...(output?.keyTakeaways ?? [])
  ].filter(Boolean).join('\n');
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
  const transcriptSummary = stripNoise(item.transcriptSummary ?? '');
  const summarizedTranscript = transcriptText ? summarizeText(stripNoise(transcriptText), 5) : '';
  const sourceText = stripNoise([
    item.summary,
    transcriptSummary,
    transcriptSummary ? '' : summarizedTranscript,
    title
  ].filter(Boolean).join(' '));
  const body = stripNoise(`${sourceText} ${(item.tags ?? []).join(' ')}`);
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
    summary: stripNoise(item.summary ?? transcriptSummary ?? title),
    transcriptSummary,
    sourceText: isSocial ? '' : sourceText,
    relatedUrls: [
      preview.social?.originalUrl,
      preview.social?.repostUrl,
      preview.social?.quotedUrl
    ].filter(Boolean),
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

function sourceEvidenceTextForSources(sources) {
  return (sources ?? [])
    .map(sourceEvidenceText)
    .filter(Boolean)
    .join(' ');
}

function sourceEvidenceText(source) {
  const pieces = [
    source?.sourceText,
    source?.transcriptSummary,
    source?.preview?.snippet,
    source?.summary
  ].filter(isUsableSourceEvidenceText);
  return stripNoise(pieces.join(' '));
}

function isUsableSourceEvidenceText(value) {
  const text = stripNoise(value);
  if (!text || UNUSABLE_SOURCE_TEXT_PATTERN.test(text)) return false;
  return wordCount(text) >= 5;
}

function groundingTermsFromText(value) {
  const generic = new Set([
    'article',
    'cited',
    'citation',
    'daily',
    'evidence',
    'feed',
    'headline',
    'headlines',
    'market',
    'measurement',
    'metadata',
    'platform',
    'signal',
    'source',
    'sources',
    'story',
    'technical',
    'terms',
    'that'
  ]);
  return [...new Set(wordsFrom(value)
    .filter((word) => word.length > 3 && !generic.has(word))
    .slice(0, 120))];
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
  const citationUrls = sources.map((source) => source.url).filter(Boolean);
  const evidenceItems = sources
    .map((source) => {
      const evidenceText = sourceEvidenceText(source);
      return evidenceText
        ? {
            ...source,
            sourceText: evidenceText,
            summary: evidenceText,
            keywords: wordsFrom(`${source.title} ${evidenceText}`).slice(0, 12)
          }
        : null;
    })
    .filter(Boolean);

  if (evidenceItems.length === 0) {
    return insufficientSourceArticle(citationUrls);
  }

  const combinedSourceText = buildCombinedSourceText(evidenceItems);
  const combinedSummary = summarizeText(combinedSourceText, 5);
  const dynamicSections = buildDynamicBodySections({
    title: stub.title,
    summary: combinedSummary,
    items: evidenceItems
  }).map((section) => ({
    ...section,
    heading: sanitizeGeneratedHeading(section.heading),
    citations: section.citations?.length ? section.citations : citationUrls.slice(0, Math.max(1, Math.min(3, citationUrls.length)))
  }));
  const bodySections = ensureBodySections(
    dedupeBodySectionsAgainstText(dynamicSections, [stub.title]).slice(0, attempt > 1 ? 4 : 3),
    { title: stub.title, summary: combinedSummary, citationUrls }
  );
  const dek = buildDek({ combinedSummary, bodySections });

  return {
    dek,
    bodySections,
    keyTakeaways: ensureKeyTakeaways(buildKeyTakeaways({
      title: stub.title,
      bodySections,
      summary: combinedSummary,
      excludeText: [dek, ...bodySections.flatMap((section) => section.paragraphs ?? [])]
    }), { title: stub.title, summary: combinedSummary, bodySections }).slice(0, attempt > 1 ? 3 : 2)
  };
}

function ensureKeyTakeaways(takeaways, { title, summary, bodySections }) {
  const output = [...(takeaways ?? [])].filter(Boolean);
  const firstSentence = sentenceSplit(summary)[0] ?? title;
  const sectionHeading = bodySections[0]?.heading ?? 'the cited technical change';
  const fillers = [
    `${trimTitle(firstSentence, 140)} is the concrete evidence readers should use before treating ${trimTitle(title, 80)} as more than a headline.`,
    `${sectionHeading} is the practical lens for the story: it ties the cited details to developer workflow, architecture, benchmarks, or operational risk.`
  ];
  for (const filler of fillers) {
    if (output.length >= 2) break;
    if (!isNearDuplicate(filler, output)) output.push(filler);
  }
  return output;
}

function ensureBodySections(sections, { title, summary, citationUrls }) {
  const output = [...(sections ?? [])].filter((section) => (section.paragraphs ?? []).length > 0);
  const sentences = sentenceSplit(summary);
  const citations = citationUrls.slice(0, Math.max(1, Math.min(3, citationUrls.length)));
  const fallbacks = [
    {
      heading: 'The Mechanism Needs A Check',
      intent: 'Explain the technical consequence of the extracted evidence.',
      paragraphs: [
        `${trimTitle(sentences[0] ?? title, 180)} The engineering consequence is to test the mechanism against benchmarks, workflow constraints, architecture fit, and operational trade-offs before treating the citation as a production-ready claim.`
      ],
      citations
    },
    {
      heading: 'The Constraint Is Operational',
      intent: 'Name the practical constraint raised by the evidence.',
      paragraphs: [
        `${trimTitle(sentences[1] ?? sentences[0] ?? title, 180)} The practical question is where the cited change would alter routing, automation, reliability, cost, or developer process in a real deployment.`
      ],
      citations
    }
  ];
  for (const fallback of fallbacks) {
    if (output.length >= 2) break;
    output.push(fallback);
  }
  return output;
}

function insufficientSourceArticle(citationUrls) {
  const citations = citationUrls.slice(0, Math.max(1, Math.min(2, citationUrls.length)));
  return {
    dek: 'This item is not ready for a grounded explainer because the citation did not include extractable article text, social text, or a transcript.',
    bodySections: [
      {
        heading: 'Extracted Source Text Is Required',
        intent: 'State why this item cannot be treated as a grounded article yet.',
        paragraphs: [
          'The citation card can identify the linked item, but it does not provide enough extracted substance to explain what the creator or publisher actually argued. A grounded TK TechNews article needs source text that names the claim, mechanism, evidence, or demo being discussed before it can add analysis.'
        ],
        citations
      },
      {
        heading: 'Grounding Comes Before Analysis',
        intent: 'Prevent generic filler when the source packet lacks usable text.',
        paragraphs: [
          'Without a usable excerpt or transcript, the article cannot responsibly infer architecture, benchmarks, workflow changes, or model behavior from the title alone. The right next step is to refresh extraction for the citation and only publish analysis once the cited material supplies concrete details.'
        ],
        citations
      }
    ],
    keyTakeaways: [
      'The citation needs extractable source text before TK TechNews can publish a grounded explainer about it.',
      'A title or thumbnail alone is not enough evidence for claims about architecture, benchmarks, workflow changes, or model behavior.'
    ]
  };
}

function sanitizeGeneratedHeading(heading) {
  return String(heading ?? '')
    .replace(/\bIs The Central Move\b/i, 'Explains The Technical Change')
    .replace(/\bChanges The Practical Tradeoff\b/i, 'Defines The Engineering Tradeoff')
    .replace(/\s+/g, ' ')
    .trim();
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
    ].join(' '),
    sourceEvidenceText: sourceEvidenceTextForSources(stub.sources)
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
    '- Do not explain feed mechanics, source metadata, or these instructions; explain only what the cited material actually says.',
    '- If the supplied sources do not contain usable extracted text or transcript detail, do not invent an explainer from the title.',
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
        usableEvidence: sourceEvidenceText(source),
        social: source.preview?.social ?? null
      }))
    }, null, 2)
  ].join('\n');
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
  if (isTweetUrl(item.url)) {
    return item.preview?.snippet || item.sourceText || item.transcriptSummary || item.summary || item.title;
  }
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
  const paragraphs = [lead, ...support].filter(Boolean);
  if (paragraphs.length === 0) return [];
  if (wordCount(paragraphs.join(' ')) >= 120) return paragraphs;
  return paragraphs.map((paragraph, index) => expandEvidenceParagraph(paragraph, { concept, index }));
}

function synthesizeConceptParagraphs({ concept, sentences }) {
  const lower = `${concept} ${sentences.join(' ')}`.toLowerCase();

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

  return [];
}

function expandEvidenceParagraph(paragraph, { concept, index }) {
  const conceptText = titleCaseConcept(concept || 'technical change');
  const followups = [
    `The mechanism to watch is concrete: ${conceptText} changes what builders measure, where workflow constraints appear, and which operational trade-offs need evidence before teams act on the claim. That gives the article a checkable claim instead of a title-level summary.`,
    `For readers, the useful test is whether those details show up in architecture choices, benchmark behavior, cost routing, or production workflow rather than only in the announcement language. That gives the article a checkable claim instead of a title-level summary.`,
    `That keeps the analysis tied to the cited material while still naming the engineering consequence that would matter in practice. That gives the article a checkable claim instead of a title-level summary.`
  ];
  return `${paragraph} ${followups[index % followups.length]}`;
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
  return `${cleaned} The ${conceptText} angle is the technical lens for interpreting that detail.`;
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
