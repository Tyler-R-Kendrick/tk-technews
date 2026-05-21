import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateNarratorOutput,
  generateNarratorRubric
} from './narrator-voice-evals.mjs';

const voiceProfile = {
  id: 'tk-technews',
  description: 'Clear, cited, practical technology analysis.',
  rules: [
    'Lead with the useful change, not hype.',
    'Preserve citations for every sourced claim.',
    'Separate observed facts from speculation.',
    'Label speculative applied opportunities explicitly.'
  ],
  avoid: [
    'Uncited claims',
    'Breathless superlatives',
    'Treating speculation as fact'
  ]
};

const journalistVoiceProfile = {
  id: 'tk-technews-journalist',
  description: 'Tech news journalism with an academic, hard-science analytical spine.',
  tone: 'journalistic-hard-science',
  detailLevel: 'analytical',
  wordChoice: {
    prefer: ['evidence', 'mechanism', 'constraint', 'benchmark', 'architecture', 'causal', 'measurement', 'trade-off', 'hypothesis'],
    avoid: ['topic brief', 'wiki page', 'node', 'community']
  },
  rules: [
    'Lead with the newsworthy technical change.',
    'Add mechanism-level explanation after the lead.',
    'Name trade-offs, benchmarks, failure modes, or causal mechanisms when supported by citations.'
  ],
  avoid: ['Pure encyclopedia tone', 'Speculation as fact']
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
  avoid: ['Overly academic jargon', 'Long article-style narrative arcs']
};

test('generated narrator rubric combines common citation, grounding, relevance, and voice dimensions', () => {
  const rubric = generateNarratorRubric({ outputKind: 'article', voiceProfile });

  assert.ok(rubric.some((item) => item.id === 'citation-coverage' && item.required));
  assert.ok(rubric.some((item) => item.id === 'grounding' && item.required));
  assert.ok(rubric.some((item) => item.id === 'voice-adherence'));
  assert.ok(rubric.some((item) => item.id === 'tone-match' && item.required));
  assert.ok(rubric.some((item) => item.id === 'word-choice' && item.required));
  assert.ok(rubric.some((item) => item.id === 'detail-level' && item.required));
  assert.ok(rubric.every((item) => item.weight > 0));
});

test('article journalist voice rejects wiki-like tone, weak hard-science diction, and thin detail', async () => {
  const report = await evaluateNarratorOutput({
    outputKind: 'article',
    output: {
      title: 'Agent Workflows',
      description: 'A short topic brief.',
      slug: 'agent-workflows',
      tags: ['agents'],
      markdownBody: [
        '## Overview',
        '',
        'Agent workflows are a topic brief for developers using AI tools. [Agents source](https://example.com/agents)',
        '',
        '## Current signals',
        '',
        'The source says OpenAI released agent workflows for developers. [Agents source](https://example.com/agents)'
      ].join('\n'),
      citations: [{ title: 'Agents source', url: 'https://example.com/agents', source: 'Example' }]
    },
    context: {
      allowedCitations: [{ title: 'Agents source', url: 'https://example.com/agents', source: 'Example' }],
      relevanceText: 'OpenAI released agent workflows for developers.'
    },
    voiceProfile: journalistVoiceProfile,
    linkCheck: 'syntax'
  });

  assert.equal(report.verdict, 'fail');
  assert.ok(report.requiredFixes.some((fix) => /hard-science/i.test(fix)));
  assert.ok(report.requiredFixes.some((fix) => /word choice/i.test(fix)));
  assert.ok(report.requiredFixes.some((fix) => /detail/i.test(fix)));
});

test('wiki narrator voice rejects article-like hard-science rhetoric and overlong page detail', async () => {
  const report = await evaluateNarratorOutput({
    outputKind: 'wiki',
    output: {
      generatedAt: '2026-05-20T18:00:00.000Z',
      graphHash: 'graph',
      landing: {
        title: 'AI Topic Wiki',
        description: 'Topic explainers.',
        overview: 'Explore AI topics.',
        featuredPageSlugs: ['agent-workflows']
      },
      pages: [{
        slug: 'agent-workflows',
        title: 'Agent Workflows',
        dek: 'A phase transition in developer automation.',
        summary: 'This article argues that agent workflows are a first-principles phase transition in software labor, with a verdict that changes the field.',
        status: 'generated',
        sections: [{
          title: 'What changed',
          body: 'OpenAI released agent workflows for developers. The mechanism reads like a laboratory trial with a phase transition narrative, a first-principles verdict, and an extended article-style arc that keeps expanding beyond a compact reference summary before the reader reaches the useful cited fact.',
          citationUrls: ['https://example.com/agents']
        }],
        keyDevelopments: [{ text: 'OpenAI released agent workflows for developers.', citationUrls: ['https://example.com/agents'] }],
        whyItMatters: 'It matters because developer teams need repeatable automation.',
        openQuestions: [],
        relatedTopics: [],
        citations: [{ title: 'Agents source', url: 'https://example.com/agents', source: 'Example' }],
        metadata: { sourceDocIds: [] }
      }]
    },
    context: {
      allowedCitations: [{ title: 'Agents source', url: 'https://example.com/agents', source: 'Example' }],
      relevanceText: 'Agent workflows for developers.'
    },
    voiceProfile: wikiVoiceProfile,
    linkCheck: 'syntax'
  });

  assert.equal(report.verdict, 'fail');
  assert.ok(report.requiredFixes.some((fix) => /wiki reference tone/i.test(fix)));
  assert.ok(report.requiredFixes.some((fix) => /word choice/i.test(fix)));
  assert.ok(report.requiredFixes.some((fix) => /concise/i.test(fix)));
});

test('article eval flags malformed, unlisted, and non-rich citations', async () => {
  const report = await evaluateNarratorOutput({
    outputKind: 'article',
    output: {
      title: 'Agent workflows update',
      description: 'A cited update.',
      slug: 'agent-workflows-update',
      tags: ['agents'],
      markdownBody: '## What changed\n\nAgent systems changed. [Broken](notaurl) [Unlisted](https://example.com/unlisted)',
      citations: [{ title: '', url: 'https://example.com/source', source: '' }]
    },
    context: {
      allowedCitations: [{ title: 'Source', url: 'https://example.com/source', source: 'Example' }],
      relevanceText: 'Agent workflows changed for developer automation.'
    },
    voiceProfile,
    linkCheck: 'syntax'
  });

  assert.equal(report.verdict, 'fail');
  assert.ok(report.requiredFixes.some((fix) => /not listed in citations/i.test(fix)));
  assert.ok(report.requiredFixes.some((fix) => /valid http/i.test(fix)));
  assert.ok(report.requiredFixes.some((fix) => /title, url, and source/i.test(fix)));
});

test('article eval flags ungrounded source URLs and low relevance drift', async () => {
  const report = await evaluateNarratorOutput({
    outputKind: 'article',
    output: {
      title: 'Banana farm pricing',
      description: 'An unrelated update.',
      slug: 'banana-farm-pricing',
      tags: ['markets'],
      markdownBody: '## What changed\n\nBanana farms shifted prices. [Outside](https://outside.example/story)',
      citations: [{ title: 'Outside', url: 'https://outside.example/story', source: 'Outside' }]
    },
    context: {
      allowedCitations: [{ title: 'Source', url: 'https://example.com/agents', source: 'Example' }],
      relevanceText: 'OpenAI released agent workflows for developers.'
    },
    voiceProfile,
    linkCheck: 'syntax'
  });

  assert.equal(report.verdict, 'fail');
  assert.ok(report.requiredFixes.some((fix) => /outside the allowed source set/i.test(fix)));
  assert.ok(report.requiredFixes.some((fix) => /does not stay relevant/i.test(fix)));
});

test('wiki eval flags internal process language and uncited generated sections', async () => {
  const report = await evaluateNarratorOutput({
    outputKind: 'wiki',
    output: {
      generatedAt: '2026-05-20T18:00:00.000Z',
      graphHash: 'graph',
      landing: {
        title: 'AI Topic Wiki',
        description: 'Topic explainers.',
        overview: 'Explore AI topics.',
        featuredPageSlugs: ['agent-workflows']
      },
      pages: [{
        slug: 'agent-workflows',
        title: 'Agent Workflows',
        dek: 'This knowledge graph node claim:abc is important.',
        summary: 'Agent workflows are changing developer automation.',
        status: 'generated',
        sections: [{ title: 'What changed', body: 'OpenAI released agent workflows.', citationUrls: [] }],
        keyDevelopments: [{ text: 'OpenAI released agent workflows.', citationUrls: ['https://example.com/agents'] }],
        whyItMatters: 'It matters because developer teams need repeatable automation.',
        openQuestions: [],
        relatedTopics: [],
        citations: [{ title: 'Agents source', url: 'https://example.com/agents', source: 'Example' }],
        metadata: { sourceDocIds: [] }
      }]
    },
    context: {
      allowedCitations: [{ title: 'Agents source', url: 'https://example.com/agents', source: 'Example' }],
      relevanceText: 'Agent workflows for developers.'
    },
    voiceProfile
  });

  assert.equal(report.verdict, 'fail');
  assert.ok(report.requiredFixes.some((fix) => /internal process language/i.test(fix)));
  assert.ok(report.requiredFixes.some((fix) => /section needs at least one citation/i.test(fix)));
});
