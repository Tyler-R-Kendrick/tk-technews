import fs from 'node:fs/promises';
import path from 'node:path';
import { frontmatterString, slugify } from './lib/text-utils.mjs';

const args = new Map(process.argv.slice(2).map((arg, index, all) => {
  if (!arg.startsWith('--')) return [];
  const next = all[index + 1];
  return [arg.slice(2), next && !next.startsWith('--') ? next : 'true'];
}).filter(Boolean));

const root = process.cwd();
const summariesPath = path.join(root, 'data', 'summaries', 'latest.json');
const knowledgePath = path.join(root, 'data', 'knowledge', 'latest.json');
const articlesDir = path.join(root, 'src', 'content', 'articles');
const topic = args.get('topic') || 'Technology News Briefing';
const slug = slugify(args.get('slug') || topic);

const summaryLedger = JSON.parse(await fs.readFile(summariesPath, 'utf8'));
const knowledgeModel = await readJsonIfExists(knowledgePath);
const usableItems = summaryLedger.items.filter((item) => item.status === 'ok').slice(0, Number(args.get('limit') ?? 8));

if (usableItems.length === 0) {
  throw new Error('No usable summaries found. Run npm run ingest and check data/summaries/latest.json.');
}

const citations = usableItems.map((item) => ({
  title: item.title,
  url: item.url,
  source: item.sourceName
}));
const knowledgeCitations = knowledgeModel?.claims
  ?.filter((claim) => usableItems.some((item) => item.id === claim.evidenceId))
  ?.map((claim) => claim.citation) ?? [];
const mergedCitations = dedupeCitations([...citations, ...knowledgeCitations]);
const selectedEntities = (knowledgeModel?.entities ?? [])
  .filter((entity) => entity.evidenceIds.some((id) => usableItems.some((item) => item.id === id)))
  .slice(0, 10);
const selectedTopics = (knowledgeModel?.topics ?? [])
  .filter((topicEntry) => topicEntry.evidenceIds.some((id) => usableItems.some((item) => item.id === id)))
  .slice(0, 8);
const selectedClaims = (knowledgeModel?.claims ?? [])
  .filter((claim) => usableItems.some((item) => item.id === claim.evidenceId))
  .slice(0, 10);

const article = [
  frontmatterString({
    title: topic,
    description: `A cited first-draft explainer generated from ${usableItems.length} collected source summaries.`,
    pubDate: new Date().toISOString().slice(0, 10),
    sourceCount: usableItems.length,
    tags: [...new Set(usableItems.flatMap((item) => item.tags ?? []))].slice(0, 8),
    knowledgeModel: knowledgeModel ? 'data/knowledge/latest.json' : 'not generated',
    citations: mergedCitations
  }),
  `## The short version\n\n${buildShortVersion(usableItems)}\n\n`,
  knowledgeModel ? `## Knowledge model\n\n${buildKnowledgeSection(selectedTopics, selectedEntities, selectedClaims)}\n\n` : '',
  `## What the sources say\n\n${usableItems.map((item, index) => sourceParagraph(item, index)).join('\n\n')}\n\n`,
  `## What it means\n\nThis is an initial synthesis draft. Before publishing, an agent or editor should replace this paragraph with a stronger explanation of the common thread, the competing interpretations, and the practical implication for readers.\n\n`,
  `## Source ledger\n\n${mergedCitations.map((citation, index) => `${index + 1}. [${citation.title}](${citation.url}) - ${citation.source}`).join('\n')}\n`
].join('');

await fs.mkdir(articlesDir, { recursive: true });
const outputPath = path.join(articlesDir, `${slug}.md`);
await fs.writeFile(outputPath, article);
console.log(`Wrote ${outputPath}`);

function buildShortVersion(items) {
  return items.slice(0, 3).map((item, index) => {
    return `${index + 1}. ${item.summary}`;
  }).join('\n');
}

function sourceParagraph(item, index) {
  return `Source ${index + 1}, [${item.title}](${item.url}), from ${item.sourceName}: ${item.summary}`;
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function dedupeCitations(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

function buildKnowledgeSection(topics, entities, claims) {
  const topicLine = topics.length > 0
    ? `Topics: ${topics.map((entry) => entry.name).join(', ')}.`
    : 'Topics: no recurring tags were extracted.';
  const entityLine = entities.length > 0
    ? `Entities: ${entities.map((entity) => entity.name).join(', ')}.`
    : 'Entities: no named entities were extracted.';
  const claimList = claims.length > 0
    ? claims.slice(0, 5).map((claim, index) => `${index + 1}. ${claim.text} [${claim.citation.title}](${claim.citation.url})`).join('\n')
    : 'No claim candidates were extracted.';

  return `${topicLine}\n\n${entityLine}\n\nClaim candidates:\n\n${claimList}`;
}
