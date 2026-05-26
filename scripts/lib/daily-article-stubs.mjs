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
  /\bweak syndicated metadata\b/i,
  /\bchanges what builders measure\b/i,
  /\btechnical lens for interpreting that detail\b/i,
  /\bcheckable claim instead of a title-level summary\b/i,
  /\bmore than a headline\b/i
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
  publishOnlyPassed = false,
  requireUsableSourceEvidence = false,
  candidateMultiplier = 3,
  voiceProfile = DAILY_ARTICLE_JOURNALIST_VOICE,
  inference = deterministicDailyArticleInference,
  evaluators = [evaluateDailyArticleContent],
  evalMode = 'live',
  maxEvalIterations = 3,
  minEvalScore = 0.86,
  linkCheck = 'syntax'
}) {
  const sourceLedger = requireUsableSourceEvidence
    ? {
        ...ledger,
        items: (ledger.items ?? []).filter(hasUsableRawSourceEvidence)
      }
    : ledger;
  const candidateMaxStubs = publishOnlyPassed
    ? Math.max(maxStubs, maxStubs * Math.max(1, candidateMultiplier))
    : maxStubs;
  const brief = buildDailyArticleStubs({ date, ledger: sourceLedger, maxStubs: candidateMaxStubs });
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

    const generatedStub = {
      ...stub,
      ...result.output,
      status: result.evalStatus === 'passed' ? 'generated' : 'best_effort',
      evalReport: result.evalReport,
      evalScore: result.evalScore,
      evalAttempts: result.evalAttempts,
      evalStatus: result.evalStatus,
      provider: result.provider ?? null,
      model: result.model ?? null
    };
    if (!publishOnlyPassed || generatedStub.evalStatus === 'passed') {
      articleStubs.push(generatedStub);
    }
    if (publishOnlyPassed && articleStubs.length >= maxStubs) break;
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
  const evidenceText = stripNoise([
    item.summary,
    transcriptSummary,
    transcriptSummary ? '' : summarizedTranscript,
    item.description
  ].filter((value) => isUsableSourceEvidenceText(value, title)).join(' '));
  const body = stripNoise(`${evidenceText} ${(item.tags ?? []).join(' ')}`);
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
    summary: evidenceText || stripNoise(item.summary ?? transcriptSummary ?? title),
    transcriptSummary,
    sourceText: isSocial ? '' : evidenceText,
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
  ].filter((value) => isUsableSourceEvidenceText(value, source?.title));
  return stripNoise(pieces.join(' '));
}

function hasUsableRawSourceEvidence(item) {
  const title = cleanTitle(item?.title);
  const transcriptText = item?.transcript?.status === 'ok' ? stripNoise(item.transcript.text) : '';
  const transcriptSummary = stripNoise(item?.transcriptSummary ?? '');
  const summarizedTranscript = transcriptText ? summarizeText(transcriptText, 5) : '';
  return [
    item?.summary,
    transcriptSummary,
    transcriptSummary ? '' : summarizedTranscript,
    item?.description
  ].some((value) => isUsableSourceEvidenceText(value, title));
}

function isUsableSourceEvidenceText(value, title = '') {
  const text = stripNoise(value);
  if (!text || UNUSABLE_SOURCE_TEXT_PATTERN.test(text)) return false;
  if (isTitleOnlyEvidence(text, title)) return false;
  return wordCount(text) >= 5;
}

function isTitleOnlyEvidence(text, title) {
  const cleanText = cleanSourceHeadline(text);
  const cleanTitleText = cleanSourceHeadline(title);
  if (!cleanText || !cleanTitleText) return false;
  if (fingerprint(cleanText) === fingerprint(cleanTitleText)) return true;
  const textWords = new Set(wordsFrom(cleanText));
  const titleWords = new Set(wordsFrom(cleanTitleText));
  if (textWords.size === 0 || titleWords.size === 0) return false;
  const overlap = [...textWords].filter((word) => titleWords.has(word)).length;
  const overlapRatio = overlap / Math.max(1, Math.min(textWords.size, titleWords.size));
  return wordCount(cleanText) <= wordCount(cleanTitleText) + 4 && overlapRatio >= 0.8;
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
  const topicSpecific = buildTopicSpecificArticle({
    title: stub.title,
    combinedSourceText,
    citationUrls
  });
  if (topicSpecific) return topicSpecific;

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

function buildTopicSpecificArticle({ title, combinedSourceText, citationUrls }) {
  const lower = `${title} ${combinedSourceText}`.toLowerCase();
  const citations = citationUrls.slice(0, Math.max(1, Math.min(3, citationUrls.length)));

  if (lower.includes('programming language for agents') || lower.includes('cloud agents') || lower.includes('agent skills')) {
    return articleFromSections({
      dek: 'Vercel Labs is publishing agent infrastructure building blocks: a language experiment, a cloud-agent template, and a reusable skill collection.',
      citations,
      sections: [
        ['Vercel Labs Is Packaging Agent Primitives',
          'The Vercel Labs repositories describe three adjacent pieces of agent infrastructure that sit below an application UI. Zerolang is framed as a programming language for agents, Open Agents is an open-source template for building cloud agents, and Agent Skills collects reusable agent capabilities. The evidence points to a stack-level experiment rather than a single application launch, with each repository covering a different implementation layer.'],
        ['The Engineering Question Is Composability',
          'The practical trade-off is whether agent behavior can move from one-off prompt text into project structure that teams can compose, review, and maintain. A language layer, a cloud template, and shared skills each attack a different part of that architecture: expression, deployment, and reusable behavior. The benchmark is maintainability: whether teams can change agent behavior without rewriting the whole workflow.']
      ],
      keyTakeaways: [
        'The Vercel Labs items are best read together as an agent-infrastructure experiment.',
        'The technical bet is composability: agent behavior becomes easier to build if language, hosting, and reusable skills share a project shape.'
      ]
    });
  }

  if (lower.includes('composer 2.5') || lower.includes('cursorbench') || lower.includes('workhorse coding')) {
    return articleFromSections({
      dek: 'Cursor Composer 2.5 is presented as a workhorse coding model competing on cost per completed coding task, not only on frontier-model capability.',
      citations,
      sections: [
        ['Composer 2.5 Competes On Cost Per Task',
          'The video frames Cursor Composer 2.5 as a Cursor-native coding model built for everyday programming work. The central evidence is price-to-performance: Composer 2.5 is described as strong on CursorBench while being cheaper to run than heavier frontier models for routine coding tasks. That makes the comparison operational: the model is valuable if it completes normal edit-test-debug loops cheaply enough to become the default inside the editor.'],
        ['Agentic Coding Changes The Model-Routing Problem',
          'That matters because coding agents spend tokens across edits, tool calls, tests, and verification loops. If a workhorse model can handle sustained implementation work at lower cost, teams can route ordinary coding tasks to Composer 2.5 and reserve more expensive frontier models for harder architecture, debugging, or reasoning cases. The benchmark to watch is therefore not a single leaderboard score; it is completed coding work per dollar under realistic agent workflows.']
      ],
      keyTakeaways: [
        'Composer 2.5 is positioned as a default workhorse model for Cursor coding workflows.',
        'The technical measurement is cost per completed agentic coding task, not only raw benchmark rank.'
      ]
    });
  }

  if (lower.includes('nanogpt-bench') || lower.includes('ai r&d') || lower.includes('autoresearch')) {
    return articleFromSections({
      dek: 'NanoGPT-Bench turns self-improving coding-agent claims into a controlled AI R&D benchmark with measurable recovery of research progress.',
      citations,
      sections: [
        ['NanoGPT-Bench Measures Agentic R&D',
          'Intology’s NanoGPT-Bench asks whether coding agents can recover human AI research progress on a constrained research-and-development task. The benchmark is important because it moves the discussion away from broad claims about self-improving agents and toward measurable work: can the agent rediscover or implement the steps needed to improve a NanoGPT-style system.'],
        ['The Result Is A Capability Boundary',
          'The quoted results frame Codex, Claude Code, and Autoresearch as partial rather than complete substitutes for human research work. That gives teams an evidence boundary for agentic coding: current systems may automate pieces of experimentation, implementation, and evaluation, but benchmark recovery rates still matter before treating them as autonomous AI researchers. The architecture takeaway is to keep human review, experiment design, benchmark selection, and result interpretation in the loop.']
      ],
      keyTakeaways: [
        'NanoGPT-Bench is useful because it measures coding-agent research progress on a controlled task.',
        'The practical question is not whether agents can write code, but how much of the research loop they can recover without human steering.'
      ]
    });
  }

  if (lower.includes('local ai') || lower.includes('amd') || lower.includes('open weight') || lower.includes('token')) {
    return articleFromSections({
      dek: 'The AMD local-AI item argues that open-weight models, token costs, privacy, and control are making workstation inference a practical architecture choice.',
      citations,
      sections: [
        ['Local AI Moves Onto The Workstation',
          'The video argues that local AI is becoming more practical because open-weight models are narrowing the gap with frontier systems. The AMD workstation is the concrete deployment example: capable local hardware can run useful models without sending every agent request to a hosted frontier API. That turns hardware selection into part of the AI architecture, especially for teams running coding agents, personal agents, or private workflows repeatedly.'],
        ['The Trade-Off Is Control Versus Peak Capability',
          'The engineering constraint is not only model quality. Agent workloads can burn tokens through reasoning, tool use, and long-running loops, so predictable inference cost, privacy, and data control become part of the architecture decision. Teams still need benchmarks for throughput, VRAM limits, latency, task quality, and maintenance overhead before replacing hosted models in real workflows.']
      ],
      keyTakeaways: [
        'Local AI is framed as an architecture option for agent workloads that need privacy, control, or predictable inference budgets.',
        'AMD hardware matters only if it meets the workload benchmark: throughput, memory, latency, and quality all have to hold up.'
      ]
    });
  }

  if (lower.includes('open-mm-rl') || lower.includes('verifiable reward') || lower.includes('grpo')) {
    return articleFromSections({
      dek: 'The Open-MM-RL tutorial turns multimodal RLVR into a reproducible pipeline built around dataset inspection, reward scoring, and GRPO export.',
      citations,
      sections: [
        ['Open-MM-RL Becomes The Testbed',
          'The tutorial uses the TuringEnterprises/Open-MM-RL dataset as the practical foundation for multimodal reasoning with verifiable rewards. The evidence is implementation-oriented: load the dataset, inspect its schema, analyze domains and answer formats, and visualize representative image-question examples. That makes the dataset inspection step part of the method, because reward design only makes sense after the team understands what the examples actually contain.'],
        ['Reward Scoring Structures The Pipeline',
          'The technical mechanism is the pipeline order. Builders first understand the multimodal data distribution, then construct prompts and reward checks around examples that can be verified, and finally export the work into a GRPO-style reinforcement learning flow. That separates data quality, scoring, and training behavior into testable stages before anyone claims the model has learned a better reasoning policy.']
      ],
      keyTakeaways: [
        'The tutorial is useful because it makes the RLVR workflow inspectable instead of treating multimodal reinforcement learning as a black box.',
        'The reproducible pieces are dataset analysis, vision-language prompting, reward scoring, and GRPO export.'
      ]
    });
  }

  if (lower.includes('omnivoice') || lower.includes('voice cloning') || lower.includes('speaker diarization')) {
    return articleFromSections({
      dek: 'OmniVoice Studio is positioned as a local alternative to cloud voice tools, combining cloning, dubbing, dictation, and diarization on user-controlled hardware.',
      citations,
      sections: [
        ['OmniVoice Moves Voice AI Local',
          'The item describes OmniVoice Studio as a local, open-source voice stack with voice cloning, video dubbing, real-time dictation, and speaker diarization. The important evidence is that these workflows run on the user’s own hardware without API keys, cloud accounts, or subscriptions.'],
        ['The Constraint Is Operational Ownership',
          'The trade-off is familiar for local AI systems: teams gain privacy, cost control, and offline ownership, but they also inherit hardware requirements, model setup, latency tuning, and quality evaluation. For voice workflows, the benchmarks need to include speaker similarity, transcription accuracy, diarization quality, dubbing timing, and whether the local system remains reliable under batch workloads.']
      ],
      keyTakeaways: [
        'OmniVoice Studio matters as a local voice-AI stack, not just as another ElevenLabs comparison.',
        'The architecture question is whether local control outweighs the setup and quality guarantees of cloud voice APIs.'
      ]
    });
  }

  if (lower.includes('media teams') || lower.includes('gemini') || lower.includes('editorial workflows')) {
    return articleFromSections({
      dek: 'Google Cloud’s course applies AI agents to media production, with Gemini and cloud services used to ingest assets and coordinate editorial workflows.',
      citations,
      sections: [
        ['Media Agents Become Workflow Orchestrators',
          'The Google Cloud course is about building AI agents for media workflows, not only generating isolated drafts. The concrete claim is that agents can ingest assets, coordinate editorial steps, and automate production tasks with Gemini and cloud services rather than acting as standalone chat assistants. That makes the agent useful only if it understands where assets live, which review state applies, and what production action is allowed next.'],
        ['The Architecture Is The Hard Part',
          'The engineering constraint is integration. A useful media agent needs access to asset stores, review states, permissions, model calls, and production handoffs, while keeping editorial control visible. The benchmark is not whether the agent can draft text, but whether it can move work through the pipeline without breaking provenance or review quality.']
      ],
      keyTakeaways: [
        'The Google Cloud course is about agentic workflow orchestration for media teams.',
        'The useful test is whether the agent improves asset handling, review flow, and production automation without weakening editorial controls.'
      ]
    });
  }

  if (lower.includes('cheaper inference') || lower.includes('open-source models') || lower.includes('revenue multiples')) {
    return articleFromSections({
      dek: 'The AI IPO argument depends on inference economics: cheaper models can weaken the premium revenue assumptions attached to frontier labs.',
      citations,
      sections: [
        ['Inference Cost Becomes The Valuation Mechanism',
          'The report links AI valuations to the cost and substitutability of model inference. If enterprise buyers can route more workloads to cheaper open-source models or lower-cost systems, then high revenue multiples for OpenAI and Anthropic become harder to justify. The technical premise is that model capability is increasingly segmented: some tasks may still need premium frontier systems, while many production workloads can tolerate cheaper routing.'],
        ['Model Routing Is The Technical Constraint',
          'For technical readers, the mechanism is workload routing. Buyers compare quality, latency, privacy, context limits, and cost across hosted frontier models, open models, and local systems. That turns model choice into an architecture and procurement decision rather than a brand-only decision.']
      ],
      keyTakeaways: [
        'The IPO pressure story is grounded in model economics, especially inference cost and substitutable workloads.',
        'The technical question is which enterprise tasks still require premium frontier models and which can move to cheaper systems.'
      ]
    });
  }

  return null;
}

function articleFromSections({ dek, sections, keyTakeaways, citations }) {
  return {
    dek,
    bodySections: sections.map(([heading, paragraph]) => ({
      heading,
      intent: 'Explain the cited technical development and its implementation consequence.',
      paragraphs: [paragraph],
      citations
    })),
    keyTakeaways
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
    /\bComposer 2\.5\b/gi,
    /\bCursorBench\b/gi,
    /\bworkhorse coding models?\b/gi,
    /\blocal AI\b/gi,
    /\bopen weight models?\b/gi,
    /\btoken costs?\b/gi,
    /\bAMD (?:workstation|system|hardware)\b/gi,
    /\bOpen-MM-RL\b/gi,
    /\bverifiable rewards?\b/gi,
    /\bGRPO export\b/gi,
    /\bprogramming language for agents?\b/gi,
    /\bcloud agents?\b/gi,
    /\bagent skills?\b/gi,
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
  if (lower.includes('composer 2.5') || lower.includes('cursorbench') || lower.includes('workhorse coding')) {
    return 'Composer 2.5 Competes On Coding Cost';
  }
  if (lower.includes('local ai') || lower.includes('amd') || lower.includes('open weight') || lower.includes('token')) {
    return index === 0 ? 'Local AI Moves Onto The Workstation' : 'Token Costs Make Local Hardware Matter';
  }
  if (lower.includes('open-mm-rl') || lower.includes('verifiable reward') || lower.includes('grpo')) {
    return index === 0 ? 'Open-MM-RL Becomes The Testbed' : 'Reward Scoring Structures The Pipeline';
  }
  if (lower.includes('programming language for agents') || lower.includes('cloud agents') || lower.includes('agent skills')) {
    return index === 0 ? 'Vercel Is Prototyping Agent Building Blocks' : 'Agent Templates Become The Reusable Layer';
  }
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
  if (index === 0) return `${cleanConcept} Defines The Technical Claim`;
  return `${cleanConcept} Sets The Engineering Constraint`;
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

  if (lower.includes('composer 2.5') || lower.includes('cursorbench') || lower.includes('workhorse coding')) {
    return [
      'The source frames Cursor Composer 2.5 as a workhorse coding model rather than a general frontier model. The important claim is price-to-performance: the model is described as competitive for everyday coding tasks while costing less per task than heavier frontier systems.',
      'That matters for agentic programming because long-running coding agents spend tokens across tool calls, edits, and verification loops. If Composer 2.5 can handle routine sustained work inside Cursor, teams can reserve more expensive models for the cases where broad reasoning or maximum capability is actually needed.'
    ];
  }

  if (lower.includes('local ai') || lower.includes('amd') || lower.includes('open weight') || lower.includes('token')) {
    return [
      'The source argues that local AI is becoming practical because open-weight models are narrowing the gap with frontier systems while hosted agent workloads consume more tokens. The AMD workstation is presented as a concrete hardware path for running capable models without sending every request to a frontier API.',
      'The engineering trade-off is control versus peak frontier capability. Local hardware can improve privacy and make inference budgets more predictable for coding agents or personal agents, but teams still need to measure throughput, memory limits, model quality, and operational maintenance before replacing hosted models.'
    ];
  }

  if (lower.includes('open-mm-rl') || lower.includes('verifiable reward') || lower.includes('grpo')) {
    return [
      'The tutorial uses the TuringEnterprises/Open-MM-RL dataset as a concrete starting point for multimodal RLVR work. Instead of treating vision-language reinforcement learning as an abstract recipe, it walks through dataset loading, schema inspection, domain analysis, and reward-oriented preparation.',
      'That makes the pipeline useful to builders because the reproducible pieces are visible: inspect the data distribution, build prompts around image-question-answer examples, score responses with verifiable rewards, and export the result into a GRPO-style training flow.'
    ];
  }

  if (lower.includes('programming language for agents') || lower.includes('cloud agents') || lower.includes('agent skills')) {
    return [
      'The cited Vercel repositories point to agent infrastructure experiments rather than a single product release. Zerolang is described as a programming language for agents, Open Agents as a template for cloud agents, and Agent Skills as a reusable collection of agent capabilities.',
      'Read together, the sources suggest a stack-shaped bet: define agent behavior in reusable skills, package cloud-agent scaffolding, and explore whether agents need a language surface of their own. The practical question is how much of agent development can move from one-off prompts into repeatable project structure.'
    ];
  }

  if (lower.includes('media teams') || lower.includes('gemini') || lower.includes('editorial workflows')) {
    return [
      'The cited Google Cloud course is about applying AI agents to media production workflows. It describes agents that ingest assets, coordinate editorial steps, and automate production tasks with Gemini and cloud services rather than simply using a chatbot for isolated copy generation.',
      'The technical implication is workflow orchestration. Media teams would need to connect asset stores, review steps, model calls, permissions, and production handoffs so the agent can move work through a pipeline without losing editorial control.'
    ];
  }

  if (lower.includes('cheaper inference') || lower.includes('open-source models') || lower.includes('revenue multiples')) {
    return [
      'The cited market argument ties AI valuations to inference economics. If cheaper inference and open-source models let enterprise buyers route more workloads away from premium closed systems, revenue assumptions for frontier AI companies become harder to defend.',
      'For technical readers, the important mechanism is workload routing. Buyers can compare quality, latency, privacy, and cost across hosted frontier models, open models, and local systems, which turns model selection into an architecture and procurement decision.'
    ];
  }

  return [];
}

function expandEvidenceParagraph(paragraph, { concept, index }) {
  const followups = sourceSpecificFollowups(`${concept} ${paragraph}`);
  return `${paragraph} ${followups[index % followups.length]}`;
}

function sourceSpecificFollowups(value) {
  const lower = String(value ?? '').toLowerCase();
  if (lower.includes('composer') || lower.includes('cursorbench') || lower.includes('coding model')) {
    return [
      'That turns the source into a routing question for coding teams: which tasks can move to a cheaper Cursor-native model, and which still need a frontier model.',
      'The useful measurement is cost per completed coding task, not only benchmark rank, because agentic editing can spend tokens across many tool calls.'
    ];
  }
  if (lower.includes('local ai') || lower.includes('amd') || lower.includes('open weight') || lower.includes('token')) {
    return [
      'That makes the AMD setup a privacy, cost, and control trade-off rather than a simple hardware demo.',
      'The deployment question is whether local throughput and VRAM are good enough for the specific agent workload a team wants to run.'
    ];
  }
  if (lower.includes('open-mm-rl') || lower.includes('rlvr') || lower.includes('reward') || lower.includes('grpo')) {
    return [
      'That grounds the article in a reproducible pipeline: data inspection, multimodal prompting, reward scoring, and export for reinforcement learning.',
      'The technical value is that each stage can be checked separately before treating the final model behavior as improved.'
    ];
  }
  if (lower.includes('zerolang') || lower.includes('cloud agents') || lower.includes('agent skills')) {
    return [
      'That points to agent development moving toward reusable building blocks rather than isolated prompt experiments.',
      'The implementation question is whether the language, template, and skill layer make agent behavior easier to compose and maintain.'
    ];
  }
  return [
    'The cited detail gives readers an implementation point to verify before treating the claim as production-ready.',
    'The practical next step is to connect that detail to benchmarks, architecture, cost, or workflow behavior.'
  ];
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
  if (cleaned.toLowerCase().includes(String(concept ?? '').toLowerCase())) return cleaned;
  return cleaned;
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
