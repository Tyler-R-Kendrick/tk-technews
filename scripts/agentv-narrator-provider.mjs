import fs from 'node:fs/promises';
import { z } from 'zod';
import { runGeneratedOutputLoop } from './lib/generation-loop.mjs';
import { articleSchema } from './lib/durable-pipeline.mjs';
import { wikiSchema } from './lib/wiki-generator.mjs';

const citation = { title: 'Agents source', url: 'https://example.com/agents', source: 'Example' };
const articleVoiceProfile = {
  id: 'tk-technews-journalist',
  description: 'Tech news journalism with an academic, hard-science analytical spine.',
  tone: 'journalistic-hard-science',
  detailLevel: 'analytical',
  wordChoice: {
    prefer: ['evidence', 'mechanism', 'constraint', 'benchmark', 'architecture', 'causal', 'measurement', 'trade-off', 'hypothesis'],
    avoid: ['topic brief', 'wiki page', 'just a list', 'node', 'community']
  },
  rules: [
    'Lead with the newsworthy technical change.',
    'Add mechanism-level explanation after the lead.',
    'Preserve citations for every sourced claim.',
    'Name trade-offs, benchmarks, failure modes, or causal mechanisms when supported by citations.',
    'Separate observed facts from speculation.'
  ],
  avoid: ['Uncited claims', 'Breathless superlatives', 'Speculation as fact']
};
const wikiVoiceProfile = {
  id: 'tk-technews-wiki',
  description: 'Neutral, compact, source-grounded wiki page narration for technical readers.',
  tone: 'reference',
  detailLevel: 'concise',
  wordChoice: {
    prefer: ['definition', 'source', 'evidence', 'context', 'relationship', 'development'],
    avoid: ['trial', 'verdict', 'phase transition', 'first-principles', 'manifold']
  },
  rules: [
    'Use neutral reference prose.',
    'Explain what the topic is before analysis.',
    'Keep sections concise and scannable.'
  ],
  avoid: ['Uncited claims', 'Overly academic jargon', 'Long article-style narrative arcs']
};

export async function runNarratorFixture(fixtureId) {
  if (fixtureId === 'article-pass') return runArticleFixture({ refine: false });
  if (fixtureId === 'article-refine') return runArticleFixture({ refine: true });
  if (fixtureId === 'article-hard-science') return runArticleFixture({ refine: false });
  if (fixtureId === 'wiki-pass') return runWikiFixture();
  if (fixtureId === 'wiki-reference') return runWikiFixture();
  throw new Error(`Unknown narrator fixture: ${fixtureId}`);
}

async function runArticleFixture({ refine }) {
  const context = {
    allowedCitations: [citation],
    relevanceText: 'OpenAI released agent workflows for developers who need repeatable review and automation loops.'
  };
  const result = await runGeneratedOutputLoop({
    task: 'agentv narrator article fixture',
    outputKind: 'article',
    schema: articleSchema,
    prompt: 'Write a cited TK TechNews article fixture.',
    context,
    voiceProfile: articleVoiceProfile,
    inference: async ({ attempt }) => ({
      output: articleOutput({ labelled: !refine || attempt > 1 }),
      provider: 'agentv-fixture',
      model: 'deterministic-fixture'
    }),
    maxIterations: refine ? 2 : 1,
    minScore: 0.86,
    linkCheck: 'syntax'
  });

  return {
    outputKind: 'article',
    output: result.output,
    context,
    voiceProfile: articleVoiceProfile,
    evalReport: result.evalReport,
    evalStatus: result.evalStatus,
    evalScore: result.evalScore,
    evalAttempts: result.evalAttempts
  };
}

async function runWikiFixture() {
  const context = {
    allowedCitations: [citation],
    relevanceText: 'Agent workflows for developers and repeatable automation loops.'
  };
  const wikiOutputSchema = wikiSchema.extend({
    generatedAt: z.string().min(1).optional().default('2026-05-20T18:00:00.000Z'),
    graphHash: z.string().min(1).optional().default('fixture-graph')
  });
  const result = await runGeneratedOutputLoop({
    task: 'agentv narrator wiki fixture',
    outputKind: 'wiki',
    schema: wikiOutputSchema,
    prompt: 'Write a cited TK TechNews wiki fixture.',
    context,
    voiceProfile: wikiVoiceProfile,
    inference: async () => ({
      output: wikiOutput(),
      provider: 'agentv-fixture',
      model: 'deterministic-fixture'
    }),
    maxIterations: 1,
    minScore: 0.86,
    linkCheck: 'syntax'
  });

  return {
    outputKind: 'wiki',
    output: result.output,
    context,
    voiceProfile: wikiVoiceProfile,
    evalReport: result.evalReport,
    evalStatus: result.evalStatus,
    evalScore: result.evalScore,
    evalAttempts: result.evalAttempts
  };
}

function articleOutput({ labelled }) {
  const opportunityLine = labelled
    ? '- Speculative applied opportunity: automate review intake for routine agent workflow changes. Confidence: 70%. Risks: needs human review for risky changes. [Agents source](https://example.com/agents)'
    : '- Automate review intake for routine agent workflow changes could help teams move faster. [Agents source](https://example.com/agents)';
  return {
    title: 'Agent Workflows Are Becoming Operational Infrastructure',
    description: 'A cited update on agent workflows for developer teams.',
    slug: 'agent-workflows-operational-infrastructure',
    tags: ['agents'],
    markdownBody: [
      '## What changed',
      '',
      'OpenAI released agent workflows for developers, and the useful news is the mechanism: a repeatable architecture for review, coding, and automation loops rather than a single chat response. [Agents source](https://example.com/agents)',
      '',
      'The cited evidence points to a constraint that matters for engineering teams: agent work has to be measured, reviewed, and bounded before it can become dependable infrastructure. [Agents source](https://example.com/agents)',
      '',
      '## Why it matters',
      '',
      'That shifts the benchmark from whether a model can answer a prompt to whether the workflow can preserve causal context, expose failure modes, and make a trade-off between speed and human oversight. [Agents source](https://example.com/agents)',
      '',
      '## Applied Opportunities',
      '',
      opportunityLine
    ].join('\n'),
    citations: [citation]
  };
}

function wikiOutput() {
  return {
    generatedAt: '2026-05-20T18:00:00.000Z',
    graphHash: 'fixture-graph',
    landing: {
      title: 'AI Topic Wiki',
      description: 'Reader-facing topic explainers from the latest source corpus.',
      overview: 'Explore current AI topics through concise explainers and cited source evidence.',
      featuredPageSlugs: ['agent-workflows']
    },
    pages: [{
      slug: 'agent-workflows',
      title: 'Agent Workflows',
      dek: 'Agent workflows are shifting AI from single prompts toward coordinated developer processes.',
      summary: 'Agent workflows are becoming a practical layer for developers who need repeatable review, coding, and automation loops backed by current AI systems.',
      status: 'generated',
      sections: [{
        title: 'What changed',
        body: 'OpenAI released agent workflows for developers, pointing toward more structured AI-assisted software processes.',
        citationUrls: ['https://example.com/agents']
      }],
      keyDevelopments: [{
        text: 'OpenAI released agent workflows for developers.',
        citationUrls: ['https://example.com/agents']
      }],
      whyItMatters: 'The shift matters because developer teams can turn AI assistance into repeatable workflows instead of isolated chat sessions.',
      openQuestions: [{
        question: 'How much review work can these workflows safely automate?',
        context: 'The cited source establishes the workflow direction, but operational reliability still needs evidence.',
        citationUrls: ['https://example.com/agents']
      }],
      relatedTopics: [],
      citations: [citation],
      metadata: { sourceDocIds: ['source-doc:agents'] }
    }]
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['output-file']) return;
  const prompt = args['prompt-file'] ? await fs.readFile(args['prompt-file'], 'utf8') : '';
  const fixtureId = fixtureIdFromPrompt(prompt, args['eval-id']);
  const result = await runNarratorFixture(fixtureId);
  await fs.writeFile(args['output-file'], JSON.stringify({
    text: JSON.stringify(result)
  }, null, 2));
}

function fixtureIdFromPrompt(prompt, evalId = '') {
  const match = String(prompt).match(/fixture:\s*([a-z0-9-]+)/i);
  if (match) return match[1];
  if (/article-refinement-loop/i.test(evalId)) return 'article-refine';
  if (/wiki-page-grounding/i.test(evalId)) return 'wiki-pass';
  return 'article-pass';
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]?.startsWith('--') ? argv[index].slice(2) : null;
    if (!key) continue;
    parsed[key] = argv[index + 1];
    index += 1;
  }
  return parsed;
}

await main();
