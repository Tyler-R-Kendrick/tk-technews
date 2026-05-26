import { readFile } from 'node:fs/promises';

const payload = JSON.parse(await readStdin());
const candidate = JSON.parse(await contentFromOutput(payload.output, payload.output_path));
const stub = candidate.stub;
const generatedText = [
  stub?.dek,
  ...(stub?.bodySections ?? []).flatMap((section) => section.paragraphs ?? []),
  ...(stub?.keyTakeaways ?? [])
].filter(Boolean).join('\n');
const sources = stub?.sources ?? [];
const socialSources = sources.filter((source) => source.preview?.kind === 'tweet');
const retweet = socialSources.find((source) => source.preview?.social?.kind === 'retweet');
const expectsSocial = sources.some((source) => /https?:\/\/(?:www\.)?(?:x|twitter)\.com\//i.test(source.url ?? ''));
const sourceEvidenceText = sources.map(sourceEvidenceTextForSource).filter(Boolean).join(' ');
const hasUsableEvidence = sourceEvidenceText.trim().length > 0;
const failures = [];
const bodyWordCount = generatedText.trim().split(/\s+/).filter(Boolean).length;

if (!stub) failures.push('Candidate must include a daily stub.');
if (/\bRT\b/.test(generatedText)) failures.push('Generated prose must not contain raw RT markers.');
if (/elvisVery|AmanUnsiloed|ExaWe|Runkleas/.test(generatedText)) failures.push('Generated prose must not contain glued retweet author/text formatting.');
if (/Read more here:\s*https?:\/\//i.test(generatedText)) failures.push('Generated prose must not flatten quoted links into paragraph text.');
if (containsInstructionMeta(generatedText)) failures.push('Generated prose must explain cited material, not feed mechanics, source metadata, or generation instructions.');
if (expectsSocial && socialSources.length === 0) failures.push('Daily stub needs at least one rich tweet preview.');
if (expectsSocial && !retweet) failures.push('Daily stub needs a rich retweet preview.');
if (retweet && retweet.preview.label !== 'Retweet') failures.push('Retweet preview label must be Retweet.');
if (retweet && !retweet.preview.social?.originalAuthor) failures.push('Retweet preview must include originalAuthor.');
if (retweet && !retweet.preview.social?.quotedUrl) failures.push('Retweet preview must preserve quotedUrl separately.');
if (hasUsableEvidence && stub?.evalStatus && stub.evalStatus !== 'passed') failures.push(`Daily generation loop evalStatus must pass when usable source evidence exists, got ${stub.evalStatus}.`);
if (!hasUsableEvidence && stub?.evalStatus !== 'best_effort') failures.push(`Daily generation loop must fail closed when source extraction is empty, got ${stub?.evalStatus}.`);
if (stub?.provider && stub.provider !== 'deterministic-daily-journalist') failures.push(`Daily generation must use the daily journalist generation loop provider, got ${stub.provider}.`);
if (!hasUsableEvidence && !(stub?.evalReport?.requiredFixes ?? []).some((fix) => /usable extracted source text|usable source|grounded/i.test(String(fix)))) {
  failures.push('Fail-closed source extraction cases must record a usable-source grounding failure.');
}
if (hasUsableEvidence) {
  if (bodyWordCount < 120) failures.push(`Daily article body needs substantive generated content, got ${bodyWordCount} words.`);
  if ((stub?.bodySections ?? []).length < 2) failures.push('Daily article needs at least two substantive generated sections.');
  if (/Changes The Practical Tradeoff|Is The Central Move/i.test(generatedText)) failures.push('Daily article headings must not use old template headings.');
  if (/^[A-Z][^\n:]{3,90}:\s*[A-Z][^\n]+$/m.test(generatedText)) failures.push('Daily article body must not be a source headline echo paragraph.');
  if (/Google Cloud course builds AI agents for media blockchain\.news|Cheap AI could derail OpenAI and Anthropic's IPOs CNBC/i.test(generatedText)) {
    failures.push('Daily article body must synthesize source headlines instead of pasting them as prose.');
  }
  if (!/\b(evidence|mechanism|constraint|measurement|trade-off|benchmark|architecture)\b/i.test(generatedText)) {
    failures.push('Daily article needs hard-science journalist terms such as evidence, mechanism, constraint, measurement, trade-off, benchmark, or architecture.');
  }
  if (sourceTermOverlap(sourceEvidenceText, generatedText) < 2) {
    failures.push('Daily article body must reuse concrete terms from usable source evidence, not generic explainer language.');
  }
}

console.log(JSON.stringify({
  score: failures.length === 0 ? 1 : 0,
  assertions: failures.length === 0
    ? [{ text: 'Daily rich social preview contract passed.', passed: true, evidence: 'daily-social' }]
    : failures.map((failure) => ({ text: failure, passed: false, evidence: 'daily-social' })),
  details: { failures }
}, null, 2));

async function contentFromOutput(output, outputPath) {
  const messages = Array.isArray(output) ? output : [];
  const content = messages
    .map((message) => typeof message?.content === 'string' ? message.content : '')
    .filter(Boolean)
    .join('\n');
  if (content) return content;
  if (outputPath) return readFile(outputPath, 'utf8');
  throw new Error('AgentV grader payload did not include candidate output.');
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function sourceEvidenceTextForSource(source) {
  return [
    source?.sourceText,
    source?.transcriptSummary,
    source?.preview?.snippet,
    source?.summary
  ].filter(isUsableSourceEvidenceText).join(' ');
}

function isUsableSourceEvidenceText(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return false;
  if (/\b(no usable text was extracted|no usable text|transcript unavailable|source text unavailable|could not extract usable text)\b/i.test(text)) return false;
  return text.split(/\s+/).filter(Boolean).length >= 5;
}

function containsInstructionMeta(value) {
  return [
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
  ].some((pattern) => pattern.test(String(value ?? '')));
}

function sourceTermOverlap(sourceText, generatedText) {
  const sourceTerms = groundingTerms(sourceText);
  const generatedTerms = new Set(groundingTerms(generatedText));
  return sourceTerms.filter((term) => generatedTerms.has(term)).length;
}

function groundingTerms(value) {
  const generic = new Set(['article', 'cited', 'citation', 'daily', 'evidence', 'feed', 'headline', 'headlines', 'market', 'measurement', 'metadata', 'platform', 'signal', 'source', 'sources', 'story', 'technical', 'terms', 'that']);
  const stop = new Set(['about', 'after', 'again', 'against', 'also', 'amid', 'and', 'from', 'into', 'latest', 'launch', 'launched', 'launches', 'new', 'news', 'release', 'released', 'releases', 'report', 'says', 'the', 'their', 'this', 'update', 'updates', 'with', 'for']);
  return [...new Set(String(value ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 3 && !stop.has(word) && !generic.has(word))
    .slice(0, 120))];
}
