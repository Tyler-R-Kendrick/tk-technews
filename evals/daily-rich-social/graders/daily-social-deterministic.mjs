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
const failures = [];
const bodyWordCount = generatedText.trim().split(/\s+/).filter(Boolean).length;

if (!stub) failures.push('Candidate must include a daily stub.');
if (/\bRT\b/.test(generatedText)) failures.push('Generated prose must not contain raw RT markers.');
if (/elvisVery|AmanUnsiloed|ExaWe|Runkleas/.test(generatedText)) failures.push('Generated prose must not contain glued retweet author/text formatting.');
if (/Read more here:\s*https?:\/\//i.test(generatedText)) failures.push('Generated prose must not flatten quoted links into paragraph text.');
if (expectsSocial && socialSources.length === 0) failures.push('Daily stub needs at least one rich tweet preview.');
if (expectsSocial && !retweet) failures.push('Daily stub needs a rich retweet preview.');
if (retweet && retweet.preview.label !== 'Retweet') failures.push('Retweet preview label must be Retweet.');
if (retweet && !retweet.preview.social?.originalAuthor) failures.push('Retweet preview must include originalAuthor.');
if (retweet && !retweet.preview.social?.quotedUrl) failures.push('Retweet preview must preserve quotedUrl separately.');
if (stub?.evalStatus && stub.evalStatus !== 'passed') failures.push(`Daily generation loop evalStatus must pass, got ${stub.evalStatus}.`);
if (stub?.provider && stub.provider !== 'deterministic-daily-journalist') failures.push(`Daily generation must use the daily journalist generation loop provider, got ${stub.provider}.`);
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
