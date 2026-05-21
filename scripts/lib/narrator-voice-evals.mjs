const DEFAULT_MIN_SCORE = 0.86;

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

const HYPE_PATTERNS = [
  /\brevolutionary\b/i,
  /\bgame[- ]changing\b/i,
  /\bmind[- ]blowing\b/i,
  /\bworld[- ]changing\b/i,
  /\bunprecedented\b/i
];

const HARD_SCIENCE_TERMS = [
  'evidence',
  'mechanism',
  'constraint',
  'benchmark',
  'architecture',
  'causal',
  'measurement',
  'trade-off',
  'hypothesis',
  'failure mode',
  'uncertainty'
];

const WIKI_REFERENCE_TERMS = [
  'definition',
  'source',
  'evidence',
  'context',
  'relationship',
  'development'
];

const ARTICLE_RHETORIC_PATTERNS = [
  /\bI argue\b/i,
  /\bthis article argues\b/i,
  /\btrial\b/i,
  /\bverdict\b/i,
  /\bphase transition\b/i,
  /\bfirst-principles\b/i,
  /\bmanifold\b/i,
  /\blaboratory\b/i
];

const WIKI_LIKE_ARTICLE_PATTERNS = [
  /\btopic brief\b/i,
  /\bwiki page\b/i,
  /\bjust a list\b/i,
  /\bpure encyclopedia\b/i
];

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'because',
  'by',
  'for',
  'from',
  'has',
  'have',
  'how',
  'in',
  'into',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'what',
  'when',
  'where',
  'who',
  'why',
  'with'
]);

export function generateNarratorRubric({ outputKind, voiceProfile = {} } = {}) {
  return [
    {
      id: 'citation-coverage',
      label: 'Citation coverage',
      weight: 0.14,
      required: true,
      criteria: `${outputKind} output has citation references wherever it makes sourced claims.`
    },
    {
      id: 'citation-richness',
      label: 'Citation richness',
      weight: 0.09,
      required: true,
      criteria: 'Each citation has a title, URL, and publisher/source label.'
    },
    {
      id: 'link-health',
      label: 'Link health',
      weight: 0.09,
      required: true,
      criteria: 'Every link is syntactically valid, and optionally live-checkable.'
    },
    {
      id: 'grounding',
      label: 'Grounding',
      weight: 0.14,
      required: true,
      criteria: 'Citations and claims stay inside the supplied source set.'
    },
    {
      id: 'relevance',
      label: 'Relevance',
      weight: 0.1,
      required: true,
      criteria: 'The output stays focused on the supplied aggregate, page topic, or research packet.'
    },
    {
      id: 'speculation-boundary',
      label: 'Speculation boundary',
      weight: 0.07,
      required: true,
      criteria: 'Speculative applied opportunities are labeled explicitly.'
    },
    {
      id: 'reader-facing-language',
      label: 'Reader-facing language',
      weight: 0.07,
      required: true,
      criteria: 'Reader-facing prose does not leak internal graph, node, or process identifiers.'
    },
    {
      id: 'tone-match',
      label: 'Tone match',
      weight: 0.1,
      required: true,
      criteria: `The ${outputKind} output uses the tone required by ${voiceProfile.id ?? 'the configured narrator'}.`
    },
    {
      id: 'word-choice',
      label: 'Word choice',
      weight: 0.08,
      required: true,
      criteria: 'The prose uses narrator-appropriate diction and avoids terms forbidden by the voice profile.'
    },
    {
      id: 'detail-level',
      label: 'Level of detail',
      weight: 0.08,
      required: true,
      criteria: 'The output has the narrator-appropriate amount of explanation: analytical for articles, concise for wiki pages.'
    },
    {
      id: 'voice-adherence',
      label: 'Voice adherence',
      weight: 0.04,
      required: false,
      criteria: `The output follows ${voiceProfile.id ?? 'the configured'} voice profile without hype.`
    }
  ];
}

export async function evaluateNarratorOutput({
  outputKind,
  output,
  context = {},
  voiceProfile = {},
  rubric = generateNarratorRubric({ outputKind, voiceProfile }),
  linkCheck = 'syntax',
  fetchImpl = globalThis.fetch,
  minScore = DEFAULT_MIN_SCORE
} = {}) {
  const assertionById = new Map([
    ['citation-coverage', evaluateCitationCoverage({ outputKind, output })],
    ['citation-richness', evaluateCitationRichness({ output })],
    ['link-health', await evaluateLinkHealth({ output, linkCheck, fetchImpl })],
    ['grounding', evaluateGrounding({ outputKind, output, context })],
    ['relevance', evaluateRelevance({ output, context })],
    ['speculation-boundary', evaluateSpeculationBoundary({ outputKind, output })],
    ['reader-facing-language', evaluateReaderFacingLanguage({ output })],
    ['tone-match', evaluateToneMatch({ outputKind, output, voiceProfile })],
    ['word-choice', evaluateWordChoice({ outputKind, output, voiceProfile })],
    ['detail-level', evaluateDetailLevel({ outputKind, output, voiceProfile })],
    ['voice-adherence', evaluateVoiceAdherence({ output, voiceProfile })]
  ]);

  const assertions = rubric.map((item) => {
    const assertion = assertionById.get(item.id) ?? passAssertion(item.id, `${item.label} passed.`);
    return {
      ...assertion,
      label: item.label,
      required: item.required,
      weight: item.weight
    };
  });

  const totalWeight = assertions.reduce((sum, item) => sum + item.weight, 0);
  const score = totalWeight === 0
    ? 1
    : assertions.reduce((sum, item) => sum + (item.score * item.weight), 0) / totalWeight;
  const requiredFixes = assertions
    .filter((item) => item.required && !item.passed)
    .map((item) => item.text);
  const feedback = assertions
    .filter((item) => !item.passed)
    .map((item) => item.text);
  const verdict = score >= minScore && requiredFixes.length === 0 ? 'pass' : 'fail';

  return {
    score: Number(score.toFixed(4)),
    verdict,
    assertions,
    feedback,
    requiredFixes,
    rubric
  };
}

function evaluateCitationCoverage({ outputKind, output }) {
  const citations = collectOutputCitations(output);
  const citationUrls = new Set(citations.map((citation) => citation.url).filter(Boolean));
  if (citations.length === 0) {
    return failAssertion('citation-coverage', 'Output needs at least one citation.');
  }

  if (outputKind === 'article') {
    const markdownTargets = extractMarkdownTargets(output.markdownBody ?? '');
    const issues = [];
    for (const target of markdownTargets) {
      if (!isHttpUrl(target)) {
        issues.push(`Markdown link target must be a valid http(s) URL: ${target}`);
      } else if (!citationUrls.has(target)) {
        issues.push(`Body link is not listed in citations: ${target}`);
      }
    }
    if (issues.length > 0) {
      return failAssertion('citation-coverage', issues.join(' '));
    }
  }

  if (outputKind === 'wiki') {
    const pages = output.pages ?? [];
    for (const page of pages.filter((candidate) => candidate.status !== 'stub')) {
      for (const section of page.sections ?? []) {
        if ((section.citationUrls ?? []).length === 0) {
          return failAssertion('citation-coverage', `Wiki page ${page.slug} section needs at least one citation: ${section.title}`);
        }
      }
      for (const development of page.keyDevelopments ?? []) {
        if ((development.citationUrls ?? []).length === 0) {
          return failAssertion('citation-coverage', `Wiki page ${page.slug} key development needs at least one citation.`);
        }
      }
    }
  }

  return passAssertion('citation-coverage', 'Citation coverage passed.');
}

function evaluateCitationRichness({ output }) {
  const weak = collectOutputCitations(output).find((citation) => {
    return !citation?.title?.trim() || !citation?.url?.trim() || !citation?.source?.trim();
  });
  if (weak) {
    return failAssertion('citation-richness', 'Every citation needs title, url, and source.');
  }
  return passAssertion('citation-richness', 'Citation richness passed.');
}

async function evaluateLinkHealth({ output, linkCheck, fetchImpl }) {
  if (linkCheck === 'off') return passAssertion('link-health', 'Link checks are disabled.');
  const urls = collectOutputUrls(output);
  const invalid = urls.find((url) => !isHttpUrl(url));
  if (invalid) {
    return failAssertion('link-health', `Link must be a valid http(s) URL: ${invalid}`);
  }
  if (linkCheck !== 'live') return passAssertion('link-health', 'Link syntax passed.');
  if (!fetchImpl) return failAssertion('link-health', 'Live link check requires fetch.');

  for (const url of urls) {
    const ok = await fetchUrlOk(url, fetchImpl);
    if (!ok) return failAssertion('link-health', `Live link check failed: ${url}`);
  }
  return passAssertion('link-health', 'Live link checks passed.');
}

function evaluateGrounding({ output, context }) {
  const allowed = collectAllowedUrls(context);
  if (allowed.size === 0) return passAssertion('grounding', 'No explicit grounding source set was supplied.');
  const outside = collectOutputUrls(output).find((url) => isHttpUrl(url) && !allowed.has(url));
  if (outside) {
    return failAssertion('grounding', `Citation URL is outside the allowed source set: ${outside}`);
  }
  return passAssertion('grounding', 'Grounding passed.');
}

function evaluateRelevance({ output, context }) {
  const expectedText = context.relevanceText
    ?? context.aggregate?.title
    ?? context.aggregate?.summary
    ?? context.researchPackets?.map((packet) => `${packet.topic} ${packet.evidence?.map((item) => item.excerpt).join(' ')}`).join(' ');
  if (!expectedText) return passAssertion('relevance', 'No explicit relevance target was supplied.');

  const expectedTerms = keywordSet(expectedText);
  if (expectedTerms.size === 0) return passAssertion('relevance', 'No relevance keywords were available.');
  const outputTerms = keywordSet(collectReaderFacingText(output));
  const overlap = [...expectedTerms].filter((term) => outputTerms.has(term)).length;
  const required = Math.max(1, Math.min(3, Math.ceil(expectedTerms.size * 0.2)));
  if (overlap < required) {
    return failAssertion('relevance', 'Output does not stay relevant to the supplied source topic.');
  }
  return passAssertion('relevance', 'Relevance passed.');
}

function evaluateSpeculationBoundary({ outputKind, output }) {
  const text = collectReaderFacingText(output);
  if (!/\b(applied opportunities?|speculative|could|might|may|opportunity)\b/i.test(text)) {
    return passAssertion('speculation-boundary', 'No speculation boundary needed.');
  }
  if (outputKind === 'article' && /Applied Opportunities/i.test(text) && !/Speculative applied opportunity/i.test(text)) {
    return failAssertion('speculation-boundary', 'Applied opportunities must use the "Speculative applied opportunity" label.');
  }
  if (/speculation as fact|will definitely|guaranteed to/i.test(text)) {
    return failAssertion('speculation-boundary', 'Speculation must not be stated as guaranteed fact.');
  }
  return passAssertion('speculation-boundary', 'Speculation boundary passed.');
}

function evaluateReaderFacingLanguage({ output }) {
  const text = collectReaderFacingText(output);
  for (const pattern of INTERNAL_LANGUAGE_PATTERNS) {
    if (pattern.test(text)) {
      return failAssertion('reader-facing-language', `Reader-facing content contains internal process language: ${pattern}`);
    }
  }
  return passAssertion('reader-facing-language', 'Reader-facing language passed.');
}

function evaluateToneMatch({ outputKind, output, voiceProfile }) {
  const text = collectReaderFacingText(output);
  if (isWikiVoice(voiceProfile) || outputKind === 'wiki') {
    const pattern = ARTICLE_RHETORIC_PATTERNS.find((candidate) => candidate.test(text));
    if (pattern) {
      return failAssertion('tone-match', `Wiki reference tone should stay neutral and concise; remove article-style hard-science rhetoric matching ${pattern}.`);
    }
    return passAssertion('tone-match', 'Tone match passed.');
  }

  if (isHardScienceJournalistVoice(voiceProfile) || outputKind === 'article') {
    const wikiPattern = WIKI_LIKE_ARTICLE_PATTERNS.find((candidate) => candidate.test(text));
    if (wikiPattern) {
      return failAssertion('tone-match', `Article hard-science journalist tone should not read like a wiki/topic brief; revise phrase matching ${wikiPattern}.`);
    }
    const hardScienceHits = distinctTermHits(text, preferredTermsForVoice(voiceProfile, HARD_SCIENCE_TERMS));
    if (hardScienceHits.length < 2) {
      return failAssertion('tone-match', 'Article hard-science journalist tone needs mechanism-level framing such as evidence, constraints, benchmarks, measurement, or causal trade-offs.');
    }
  }

  return passAssertion('tone-match', 'Tone match passed.');
}

function evaluateWordChoice({ outputKind, output, voiceProfile }) {
  const text = collectReaderFacingText(output);
  const avoidTerms = [
    ...(voiceProfile.wordChoice?.avoid ?? []),
    ...(voiceProfile.avoid ?? [])
  ].filter(Boolean);
  const forbidden = avoidTerms.find((term) => containsTerm(text, term));
  if (forbidden) {
    return failAssertion('word-choice', `Voice word choice forbids "${forbidden}".`);
  }

  if (isHardScienceJournalistVoice(voiceProfile) || outputKind === 'article') {
    const hits = distinctTermHits(text, preferredTermsForVoice(voiceProfile, HARD_SCIENCE_TERMS));
    if (hits.length < 2) {
      return failAssertion('word-choice', 'Article word choice needs at least two hard-science or academic analysis terms from the narrator profile.');
    }
  }

  if (isWikiVoice(voiceProfile) || outputKind === 'wiki') {
    const hits = distinctTermHits(text, preferredTermsForVoice(voiceProfile, WIKI_REFERENCE_TERMS));
    if (hits.length < 1) {
      return failAssertion('word-choice', 'Wiki word choice should use neutral reference terms such as source, evidence, context, development, or definition.');
    }
  }

  return passAssertion('word-choice', 'Word choice passed.');
}

function evaluateDetailLevel({ outputKind, output, voiceProfile }) {
  const detailLevel = String(voiceProfile.detailLevel ?? '').toLowerCase();
  if (detailLevel === 'analytical' || (outputKind === 'article' && isHardScienceJournalistVoice(voiceProfile))) {
    const body = output?.markdownBody ?? collectReaderFacingText(output);
    const words = wordCount(body);
    const headingCount = [...String(body).matchAll(/^##\s+/gm)].length;
    if (words < 90 || headingCount < 2) {
      return failAssertion('detail-level', 'Article level of detail should be analytical: use at least two sections and enough mechanism, evidence, constraint, or measurement detail to support the story.');
    }
  }

  if (detailLevel === 'concise' || (outputKind === 'wiki' && isWikiVoice(voiceProfile))) {
    for (const page of output?.pages ?? []) {
      if (wordCount(page.summary) > 45) {
        return failAssertion('detail-level', `Wiki concise detail failed for ${page.slug}: summary should stay compact.`);
      }
      const longSection = (page.sections ?? []).find((section) => wordCount(section.body) > 30);
      if (longSection) {
        return failAssertion('detail-level', `Wiki concise detail failed for ${page.slug}: section "${longSection.title}" should be shorter and more scannable.`);
      }
    }
  }

  return passAssertion('detail-level', 'Level of detail passed.');
}

function evaluateVoiceAdherence({ output }) {
  const text = collectReaderFacingText(output);
  for (const pattern of HYPE_PATTERNS) {
    if (pattern.test(text)) {
      return failAssertion('voice-adherence', `Voice profile avoids hype; remove phrase matching ${pattern}.`, { required: false });
    }
  }
  return passAssertion('voice-adherence', 'Voice adherence passed.');
}

function isHardScienceJournalistVoice(voiceProfile = {}) {
  return /journalist|hard-science|hard science/i.test(`${voiceProfile.id ?? ''} ${voiceProfile.tone ?? ''} ${voiceProfile.description ?? ''}`);
}

function isWikiVoice(voiceProfile = {}) {
  return /wiki|reference/i.test(`${voiceProfile.id ?? ''} ${voiceProfile.tone ?? ''} ${voiceProfile.description ?? ''}`);
}

function preferredTermsForVoice(voiceProfile = {}, fallback = []) {
  return [...new Set([...(voiceProfile.wordChoice?.prefer ?? []), ...fallback].filter(Boolean))];
}

function distinctTermHits(text, terms) {
  return [...new Set(terms.filter((term) => containsTerm(text, term)).map((term) => String(term).toLowerCase()))];
}

function containsTerm(text, term) {
  const escaped = String(term).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\ /g, '[\\s-]+');
  if (!escaped) return false;
  return new RegExp(`\\b${escaped}\\b`, 'i').test(String(text));
}

function wordCount(text) {
  return String(text ?? '').trim().split(/\s+/).filter(Boolean).length;
}

function collectOutputCitations(output) {
  const citations = [];
  for (const citation of output?.citations ?? []) citations.push(citation);
  for (const page of output?.pages ?? []) {
    for (const citation of page.citations ?? []) citations.push(citation);
  }
  return dedupeByUrl(citations);
}

function collectOutputUrls(output) {
  return [
    ...collectOutputCitations(output).map((citation) => citation.url).filter(Boolean),
    ...extractMarkdownTargets(output?.markdownBody ?? ''),
    ...collectWikiCitationUrls(output)
  ];
}

function collectWikiCitationUrls(output) {
  const urls = [];
  for (const page of output?.pages ?? []) {
    for (const section of page.sections ?? []) urls.push(...(section.citationUrls ?? []));
    for (const item of page.keyDevelopments ?? []) urls.push(...(item.citationUrls ?? []));
    for (const question of page.openQuestions ?? []) urls.push(...(question.citationUrls ?? []));
  }
  return urls;
}

function collectAllowedUrls(context = {}) {
  const citations = [
    ...(context.allowedCitations ?? []),
    ...(context.aggregate?.citations ?? []),
    ...(context.researchPackets ?? []).flatMap((packet) => packet.citations ?? [])
  ];
  return new Set(citations.map((citation) => citation.url).filter(Boolean));
}

function collectReaderFacingText(output) {
  if (!output) return '';
  if (output.markdownBody) {
    return [
      output.title,
      output.description,
      output.markdownBody
    ].filter(Boolean).join('\n');
  }
  if (output.pages) {
    return JSON.stringify({
      landing: output.landing,
      pages: output.pages.map((page) => ({
        title: page.title,
        dek: page.dek,
        summary: page.summary,
        sections: page.sections,
        keyDevelopments: page.keyDevelopments,
        whyItMatters: page.whyItMatters,
        openQuestions: page.openQuestions,
        relatedTopics: page.relatedTopics
      }))
    });
  }
  return JSON.stringify(output);
}

function extractMarkdownTargets(markdown) {
  return [...String(markdown).matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1].trim());
}

function isHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

async function fetchUrlOk(url, fetchImpl) {
  try {
    let response = await fetchImpl(url, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
    if (response.status === 405 || response.status === 403) {
      response = await fetchImpl(url, { method: 'GET', signal: AbortSignal.timeout(10000) });
    }
    return response.ok;
  } catch {
    return false;
  }
}

function keywordSet(text) {
  return new Set(String(text)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((term) => term.replace(/^-+|-+$/g, ''))
    .filter((term) => term.length >= 4 && !STOP_WORDS.has(term)));
}

function dedupeByUrl(citations) {
  const seen = new Set();
  return citations.filter((citation) => {
    const key = citation?.url ?? JSON.stringify(citation);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function passAssertion(name, text) {
  return { name, text, passed: true, score: 1 };
}

function failAssertion(name, text) {
  return { name, text, passed: false, score: 0 };
}
