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

/**
 * Build a rubric of evaluation items tailored to a specific output kind and voice profile.
 * @param {Object} [opts] - Options for rubric generation.
 * @param {'article'|'wiki'} [opts.outputKind] - The kind of output to evaluate, used to parameterize item criteria.
 * @param {Object} [opts.voiceProfile={}] - Voice profile that influences tone, word-choice, and criteria wording (may include `id`, `tone`, `description`, and `wordChoice` fields).
 * @returns {Array<Object>} An array of rubric items. Each item has `id`, `label`, `weight`, `required`, and `criteria` describing the evaluation requirement.
 */
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

/**
 * Evaluate an output against the narrator rubric and compute a weighted score, verdict, and per-item assertions.
 *
 * @param {Object} params
 * @param {'article'|'wiki'} params.outputKind - The kind of output being evaluated; selects rubric and some check behavior.
 * @param {Object} params.output - The content object to evaluate (may contain markdownBody, citations, pages, title, etc.).
 * @param {Object} [params.context={}] - Context used for grounding and relevance (e.g., allowedCitations, aggregate, researchPackets).
 * @param {Object} [params.voiceProfile={}] - Voice/profile preferences that influence tone, word choice, and detail-level checks.
 * @param {Array} [params.rubric] - Optional rubric array to use; defaults to generateNarratorRubric({ outputKind, voiceProfile }).
 * @param {'off'|'syntax'|'live'} [params.linkCheck='syntax'] - Level of URL checking to perform.
 * @param {number} [params.minScore=DEFAULT_MIN_SCORE] - Minimum weighted score threshold required for a passing verdict.
 *
 * @returns {Object} Evaluation result containing computed metrics and diagnostic assertions.
 * @returns {number} returns.score - Weighted score in [0,1], rounded to 4 decimals.
 * @returns {'pass'|'fail'} returns.verdict - `'pass'` if score >= minScore and no required assertions failed, otherwise `'fail'`.
 * @returns {Array<Object>} returns.assertions - Per-rubric-item assertion objects (include name/text/passed/score plus label, required, weight).
 * @returns {Array<string>} returns.feedback - Text messages for all failed assertions.
 * @returns {Array<string>} returns.requiredFixes - Text messages for failed assertions marked as required.
 * @returns {Array} returns.rubric - The rubric used for this evaluation.
 */
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

/**
 * Validate that the output includes citations and that those citations cover body links (for articles) or page sections/key developments (for wikis).
 * @param {{outputKind: string, output: object}} params - Evaluation inputs.
 * @param {'article'|'wiki'|string} params.outputKind - The kind of output to validate; affects structural checks.
 * @param {object} params.output - The output payload containing `citations`, `markdownBody`, and/or `pages`.
 * @returns {{name: string, text: string, passed: boolean, score: number}} An assertion object indicating pass or fail with an explanatory message.
 */
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

/**
 * Checks that every collected citation includes a non-empty title, url, and source.
 * @param {{}} output - The content object whose citations will be inspected.
 * @returns {{name: string, text: string, passed: boolean, score: number}} An assertion object: `passed: true` when all citations have `title`, `url`, and `source`, otherwise `passed: false` with a failure message.
 */
function evaluateCitationRichness({ output }) {
  const weak = collectOutputCitations(output).find((citation) => {
    return !citation?.title?.trim() || !citation?.url?.trim() || !citation?.source?.trim();
  });
  if (weak) {
    return failAssertion('citation-richness', 'Every citation needs title, url, and source.');
  }
  return passAssertion('citation-richness', 'Citation richness passed.');
}

/**
 * Validates and (optionally) live-checks all URLs extracted from an output.
 * @param {Object} params
 * @param {Object} params.output - Output object to extract URLs from (citations, markdown links, wiki pages).
 * @param {'off'|'syntax'|'live'} params.linkCheck - Level of checking: `'off'` skips checks, `'syntax'` validates URL syntax only, `'live'` performs HTTP probes.
 * @param {Function} [params.fetchImpl] - Fetch implementation used for live HTTP requests; required when `linkCheck` is `'live'`.
 * @returns {Object} Assertion object with `name`, `text`, `passed`, and `score`. On failure, `text` identifies the first invalid or unreachable URL or missing `fetchImpl`.
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

/**
 * Validates that all HTTP(S) URLs in the output are within the allowed citation set.
 *
 * Checks collected output URLs against the allowed URLs derived from `context`.
 * If no allowed URLs are provided, the check passes. If any HTTP(S) URL from the
 * output is not present in the allowed set, the function returns a failing assertion
 * identifying the first offending URL.
 *
 * @param {object} params.output - The output object to inspect (may contain citations, markdownBody, pages, etc.).
 * @param {object} params.context - Context used to build the allowed URL set (e.g., allowedCitations, aggregate, researchPackets).
 * @returns {object} An assertion object: `passed: false` if an output HTTP(S) URL is outside the allowed set (includes the offending URL in the message), otherwise `passed: true`.
 */
function evaluateGrounding({ output, context }) {
  const allowed = collectAllowedUrls(context);
  if (allowed.size === 0) return passAssertion('grounding', 'No explicit grounding source set was supplied.');
  const outside = collectOutputUrls(output).find((url) => isHttpUrl(url) && !allowed.has(url));
  if (outside) {
    return failAssertion('grounding', `Citation URL is outside the allowed source set: ${outside}`);
  }
  return passAssertion('grounding', 'Grounding passed.');
}

/**
 * Evaluates whether the output stays topically relevant to the supplied context.
 *
 * Determines an expected relevance target from `context.relevanceText`, `context.aggregate.title` or `summary`, or from `context.researchPackets` (concatenated packet `topic` and evidence `excerpt` values). Extracts keyword sets from that target and from the reader-facing text of `output`, and compares overlap against a small dynamic threshold to decide relevance.
 * @param {Object} params
 * @param {Object} params.output - The generated output object to evaluate (may contain `markdownBody`, `title`, `description`, or `pages`).
 * @param {Object} params.context - Context used to derive the relevance target.
 * @param {string} [params.context.relevanceText] - Explicit text to use as the relevance target.
 * @param {Object} [params.context.aggregate] - Aggregate metadata; `title` or `summary` may be used as fallback relevance text.
 * @param {Array<Object>} [params.context.researchPackets] - Array of research packets; each packet's `topic` and `evidence[].excerpt` are concatenated if no other target is available.
 * @returns {Object} An assertion object describing the relevance check result: `{ name, text, passed, score }` where `passed` is `true` if the overlap meets the required threshold and `false` otherwise.
 */
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

/**
 * Evaluates whether reader-facing text applies appropriate speculation boundaries.
 *
 * Checks reader-facing content for speculative keywords; if none are present, it passes.
 * For `article` outputs, enforces that sections titled "Applied Opportunities" are labeled
 * as "Speculative applied opportunity". Fails if speculative claims are stated as guaranteed
 * fact (e.g., "will definitely", "guaranteed to", "speculation as fact").
 *
 * @param {Object} params
 * @param {'article'|'wiki'|string} params.outputKind - The kind of output being evaluated; affects labeling rules.
 * @param {Object} params.output - The output object whose reader-facing text will be examined.
 * @returns {Object} An assertion object with `name`, `text`, `passed`, and `score` describing the result.
 */
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

/**
 * Validates that reader-facing text does not contain internal process or implementation language.
 *
 * @param {Object} params
 * @param {*} params.output - The output object to inspect (e.g., article/wiki shape).
 * @returns {Object} An assertion object named `reader-facing-language`: `passed: false` with a message identifying the matching internal-language pattern if a violation is found; otherwise `passed: true` with a passing message.
 */
function evaluateReaderFacingLanguage({ output }) {
  const text = collectReaderFacingText(output);
  for (const pattern of INTERNAL_LANGUAGE_PATTERNS) {
    if (pattern.test(text)) {
      return failAssertion('reader-facing-language', `Reader-facing content contains internal process language: ${pattern}`);
    }
  }
  return passAssertion('reader-facing-language', 'Reader-facing language passed.');
}

/**
 * Validate that the output's tone matches the expected voice profile and output kind.
 *
 * For wiki voices or wiki outputs, fails if article-style hard-science rhetoric is detected.
 * For hard-science journalist voices or article outputs, fails if wiki-like phrasing is present
 * or if the text does not contain at least two distinct preferred hard-science terms.
 *
 * @param {Object} params
 * @param {string} params.outputKind - The kind of output (e.g., "article" or "wiki").
 * @param {Object} params.output - The output object whose reader-facing text will be evaluated.
 * @param {Object} params.voiceProfile - Voice profile that adjusts tone expectations (may include id, tone, and word-choice preferences).
 * @returns {Object} An assertion object describing the result: `{ name, text, passed, score }`.
 */
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

/**
 * Evaluates whether reader-facing text uses allowed and appropriate word choice for the given voice and output kind.
 *
 * Checks for presence of any avoided words from the voice profile and enforces required preferred-term counts:
 * - For article/hard-science voices, requires at least two distinct hard-science/analysis terms.
 * - For wiki/reference voices, requires at least one neutral reference term.
 *
 * @param {Object} params
 * @param {'article'|'wiki'|string} params.outputKind - The kind of output being evaluated (e.g., "article" or "wiki").
 * @param {Object} params.output - The output object whose reader-facing text will be evaluated.
 * @param {Object} params.voiceProfile - Voice/profile configuration; may include `wordChoice.avoid` and `wordChoice.prefer` lists and top-level `avoid`.
 * @returns {Object} An assertion object ({ name, text, passed, score }) describing pass/fail and explanatory text.
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

/**
 * Validates that the content's level of detail matches the requested voice or output kind.
 *
 * When the voice or output requires "analytical" detail (explicit `voiceProfile.detailLevel === "analytical"` or an article in a hard-science journalist voice), ensures the main reader-facing body has at least 90 words and at least two level-2 sections. When the voice or output requires "concise" detail (explicit `voiceProfile.detailLevel === "concise"` or a wiki voice/output), ensures each wiki page summary is no more than 45 words and no page section body exceeds 30 words. Returns a failing assertion with a human-readable failure message on the first violation, otherwise returns a passing assertion.
 *
 * @param {Object} params
 * @param {'article'|'wiki'|string} params.outputKind - The kind of output being evaluated.
 * @param {Object} params.output - The content object to evaluate (may contain markdownBody, title, pages, etc.).
 * @param {Object} params.voiceProfile - Voice/profile metadata (may include `detailLevel` and tone identifiers).
 * @returns {Object} An assertion object indicating pass or fail and containing a descriptive message.
 */
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

/**
 * Checks reader-facing text for hype phrases to enforce voice adherence.
 * @param {Object} output - The output object whose reader-facing text will be scanned for disallowed hype patterns.
 * @returns {Object} An assertion object: if a hype pattern is found, an object with `passed: false`, feedback text indicating the offending pattern, and `required: false`; otherwise an object with `passed: true` and a positive message.
 */
function evaluateVoiceAdherence({ output }) {
  const text = collectReaderFacingText(output);
  for (const pattern of HYPE_PATTERNS) {
    if (pattern.test(text)) {
      return failAssertion('voice-adherence', `Voice profile avoids hype; remove phrase matching ${pattern}.`, { required: false });
    }
  }
  return passAssertion('voice-adherence', 'Voice adherence passed.');
}

/**
 * Determines whether a voice profile should be treated as a hard-science journalist voice.
 * @param {object} voiceProfile - Profile object; `id`, `tone`, and `description` (if present) are inspected for keywords.
 * @returns {boolean} `true` if any of `id`, `tone`, or `description` contains "journalist", "hard-science", or "hard science" (case-insensitive), `false` otherwise.
 */
function isHardScienceJournalistVoice(voiceProfile = {}) {
  return /journalist|hard-science|hard science/i.test(`${voiceProfile.id ?? ''} ${voiceProfile.tone ?? ''} ${voiceProfile.description ?? ''}`);
}

/**
 * Detects whether a voice profile should be treated as a wiki or reference voice.
 * @param {Object} [voiceProfile={}] - Voice profile object; may include `id`, `tone`, and `description` fields.
 * @returns {boolean} `true` if `voiceProfile.id`, `voiceProfile.tone`, or `voiceProfile.description` contains "wiki" or "reference" (case-insensitive), `false` otherwise.
 */
function isWikiVoice(voiceProfile = {}) {
  return /wiki|reference/i.test(`${voiceProfile.id ?? ''} ${voiceProfile.tone ?? ''} ${voiceProfile.description ?? ''}`);
}

/**
 * Build a deduplicated list of preferred vocabulary for a voice profile, falling back to provided terms.
 *
 * @param {object} [voiceProfile={}] - Voice profile object which may include `wordChoice.prefer` as an array of preferred terms.
 * @param {string[]} [fallback=[]] - Additional terms to include if the voice profile does not specify preferences.
 * @returns {string[]} An array of unique preferred terms (lower/upper casing preserved) combining the voice profile's preferences and the fallback list.
 */
function preferredTermsForVoice(voiceProfile = {}, fallback = []) {
  return [...new Set([...(voiceProfile.wordChoice?.prefer ?? []), ...fallback].filter(Boolean))];
}

/**
 * Find unique terms from a list that appear in the given text, returned in lowercase.
 * @param {string} text - Text to search for term matches.
 * @param {Array<string>} terms - Candidate terms to test for presence in the text.
 * @returns {Array<string>} An array of matched terms (deduplicated), each converted to lowercase.
 */
function distinctTermHits(text, terms) {
  return [...new Set(terms.filter((term) => containsTerm(text, term)).map((term) => String(term).toLowerCase()))];
}

/**
 * Checks whether a text contains a given term as a whole-word match, with flexible spacing/hyphen handling.
 *
 * The `term` is treated as a literal string with regex metacharacters escaped. Use the sequence `\ ` inside
 * `term` to allow flexible matching of one or more whitespace characters or hyphens (e.g., `multi\ word` matches
 * "multi word", "multi-word", or "multi   word"). Matching is case-insensitive and anchored to word boundaries.
 *
 * @param {string} text - The text to search.
 * @param {string} term - The term to find; may include `\ ` placeholders for flexible spaces/hyphens.
 * @returns {boolean} `true` if a whole-word, case-insensitive match of `term` exists in `text`, `false` otherwise.
 */
function containsTerm(text, term) {
  const escaped = String(term).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\ /g, '[\\s-]+');
  if (!escaped) return false;
  return new RegExp(`\\b${escaped}\\b`, 'i').test(String(text));
}

/**
 * Count the words in the given text.
 * @param {any} text - Input whose words will be counted; non-string values are coerced to a string.
 * @returns {number} The number of whitespace-separated words (0 if the input is empty or only contains whitespace).
 */
function wordCount(text) {
  return String(text ?? '').trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Collects all citation objects present in an output structure and returns a URL-deduplicated list.
 * @param {object} output - The output object which may contain top-level `citations` and a `pages` array.
 * @return {Array<object>} An array of citation objects aggregated from `output.citations` and each `page.citations`, with duplicates removed by URL.
 */
function collectOutputCitations(output) {
  const citations = [];
  for (const citation of output?.citations ?? []) citations.push(citation);
  for (const page of output?.pages ?? []) {
    for (const citation of page.citations ?? []) citations.push(citation);
  }
  return dedupeByUrl(citations);
}

/**
 * Collects all URLs referenced by an output (citations, markdown link targets, and wiki citation URLs).
 * @param {object} output - Object that may include `citations` (array of citation objects with `url`), `markdownBody` (string), and wiki `pages` containing section/keyDevelopment/openQuestion citation URL lists.
 * @returns {string[]} Array of URL strings found in the output (may include duplicates).
 */
function collectOutputUrls(output) {
  return [
    ...collectOutputCitations(output).map((citation) => citation.url).filter(Boolean),
    ...extractMarkdownTargets(output?.markdownBody ?? ''),
    ...collectWikiCitationUrls(output)
  ];
}

/**
 * Collects all citation URLs found in a wiki-style output's pages.
 *
 * Iterates each page and gathers citation URLs from page.sections[].citationUrls,
 * page.keyDevelopments[].citationUrls, and page.openQuestions[].citationUrls.
 *
 * @param {Object} output - The output object potentially containing a `pages` array.
 * @returns {string[]} An array of citation URLs found (in discovery order; may be empty and may contain duplicates).
 */
function collectWikiCitationUrls(output) {
  const urls = [];
  for (const page of output?.pages ?? []) {
    for (const section of page.sections ?? []) urls.push(...(section.citationUrls ?? []));
    for (const item of page.keyDevelopments ?? []) urls.push(...(item.citationUrls ?? []));
    for (const question of page.openQuestions ?? []) urls.push(...(question.citationUrls ?? []));
  }
  return urls;
}

/**
 * Collects citation URLs from the provided context and returns them as a unique set.
 *
 * @param {Object} context - Container of allowed citations and aggregated research.
 * @param {Array<{url: string}>} [context.allowedCitations] - Explicitly allowed citation objects.
 * @param {Object} [context.aggregate] - Aggregate object possibly containing `citations`.
 * @param {Array<{url: string}>} [context.aggregate.citations] - Citations from the aggregate.
 * @param {Array<Object>} [context.researchPackets] - Research packets each potentially containing `citations`.
 * @param {Array<{url: string}>} [context.researchPackets[].citations] - Citations within each research packet.
 * @returns {Set<string>} A Set of unique citation URL strings extracted from the context.
 */
function collectAllowedUrls(context = {}) {
  const citations = [
    ...(context.allowedCitations ?? []),
    ...(context.aggregate?.citations ?? []),
    ...(context.researchPackets ?? []).flatMap((packet) => packet.citations ?? [])
  ];
  return new Set(citations.map((citation) => citation.url).filter(Boolean));
}

/**
 * Extracts the reader-facing text representation from an output object for analysis.
 *
 * @param {object} output - The output object produced by content generation. If `output.markdownBody` exists, `output.title`, `output.description`, and `output.markdownBody` are concatenated. If `output.pages` exists, a normalized projection of `landing` and each page's public-facing fields (title, dek, summary, sections, keyDevelopments, whyItMatters, openQuestions, relatedTopics) is returned as a JSON string. If `output` is falsy, an empty string is returned.
 * @returns {string} A string containing the reader-facing text: concatenated markdown fields when present, or a JSON-stringified projection of pages/landing, or an empty string if no output.
 */
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

/**
 * Extracts link targets from Markdown links.
 * @param {string} markdown - Markdown text to scan for link targets.
 * @returns {string[]} An array of trimmed link targets (the contents inside parentheses of `](...)`) in the order they appear.
 */
function extractMarkdownTargets(markdown) {
  return [...String(markdown).matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1].trim());
}

/**
 * Check whether a string is a syntactically valid HTTP or HTTPS URL.
 * @param {string} url - The string to validate as a URL.
 * @returns {boolean} `true` if the input is a valid `http` or `https` URL, `false` otherwise.
 */
function isHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Checks whether a URL is reachable by issuing an HTTP request and returning whether the response is OK.
 *
 * Attempts a `HEAD` request with a 10s timeout; if the response status is `405` or `403`, retries with `GET`
 * (also with a 10s timeout). Any thrown error or non-OK response results in `false`.
 * @param {string} url - The URL to check.
 * @param {Function} fetchImpl - Fetch implementation to use (signature like `fetch`). Required for live requests.
 * @returns {boolean} `true` if a request completes and `response.ok` is `true`, `false` otherwise.
 */
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

/**
 * Extracts a set of normalized keywords from input text for relevance matching.
 *
 * @param {string} text - Source text from which to extract keywords.
 * @returns {Set<string>} A set of unique, lowercase keywords (trimmed of surrounding hyphens), each at least 4 characters long and excluding common stop words and URLs.
 */
function keywordSet(text) {
  return new Set(String(text)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((term) => term.replace(/^-+|-+$/g, ''))
    .filter((term) => term.length >= 4 && !STOP_WORDS.has(term)));
}

/**
 * Remove duplicate citation entries, keeping the first occurrence for each unique citation URL.
 * @param {Array<Object>} citations - Array of citation objects; items may include a `url` property.
 * @returns {Array<Object>} The filtered citations array where duplicates (by `citation.url`, or by JSON serialization when `url` is absent) are removed, preserving original order.
 */
function dedupeByUrl(citations) {
  const seen = new Set();
  return citations.filter((citation) => {
    const key = citation?.url ?? JSON.stringify(citation);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Create a standardized passing assertion result.
 * @param {string} name - Assertion identifier.
 * @param {string} text - Human-readable assertion message.
 * @returns {{name: string, text: string, passed: true, score: 1}} An assertion object with `passed: true` and `score: 1`.
 */
function passAssertion(name, text) {
  return { name, text, passed: true, score: 1 };
}

/**
 * Create a failing assertion result for a rubric check.
 * @param {string} name - Assertion identifier.
 * @param {string} text - Human-readable failure message or explanation.
 * @returns {{name: string, text: string, passed: boolean, score: number}} An assertion object marked as failed with `passed: false` and `score: 0`.
 */
function failAssertion(name, text) {
  return { name, text, passed: false, score: 0 };
}
