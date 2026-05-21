import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { runGeneratedOutputLoop } from './generation-loop.mjs';

const tinySchema = z.object({
  title: z.string(),
  body: z.string(),
  citations: z.array(z.object({
    title: z.string(),
    url: z.string(),
    source: z.string()
  }))
});

test('shared generation loop returns the first schema-valid output when eval passes', async () => {
  let calls = 0;

  const result = await runGeneratedOutputLoop({
    task: 'test generation',
    outputKind: 'article',
    schema: tinySchema,
    prompt: 'Write a cited article.',
    context: {},
    inference: async () => {
      calls += 1;
      return {
        output: citedOutput('Strong first pass'),
        provider: 'test-provider',
        model: 'test-model'
      };
    },
    evaluators: [passingEvaluator],
    maxIterations: 3,
    minScore: 0.86
  });

  assert.equal(calls, 1);
  assert.equal(result.output.title, 'Strong first pass');
  assert.equal(result.provider, 'test-provider');
  assert.equal(result.model, 'test-model');
  assert.equal(result.evalStatus, 'passed');
  assert.equal(result.evalScore, 1);
  assert.equal(result.evalAttempts, 1);
});

test('shared generation loop refines with evaluator feedback until output passes', async () => {
  const prompts = [];

  const result = await runGeneratedOutputLoop({
    task: 'test generation',
    outputKind: 'article',
    schema: tinySchema,
    prompt: 'Write a cited article.',
    context: {},
    inference: async ({ prompt }) => {
      prompts.push(prompt);
      return {
        output: citedOutput(prompts.length === 1 ? 'Thin first pass' : 'Improved second pass'),
        provider: 'test-provider',
        model: 'test-model'
      };
    },
    evaluators: [
      async ({ attempt }) => attempt === 1
        ? failingReport(0.42, ['Add richer citations before publication.'])
        : passingReport()
    ],
    maxIterations: 3,
    minScore: 0.86
  });

  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /Add richer citations before publication/);
  assert.equal(result.output.title, 'Improved second pass');
  assert.equal(result.evalStatus, 'passed');
  assert.equal(result.evalAttempts, 2);
});

test('shared generation loop persists best effort after max eval attempts', async () => {
  const result = await runGeneratedOutputLoop({
    task: 'test generation',
    outputKind: 'article',
    schema: tinySchema,
    prompt: 'Write a cited article.',
    context: {},
    inference: async ({ attempt }) => ({
      output: citedOutput(`Attempt ${attempt}`),
      provider: 'test-provider',
      model: 'test-model'
    }),
    evaluators: [
      async ({ attempt }) => failingReport(attempt === 1 ? 0.25 : 0.55, [`Attempt ${attempt} still needs work.`])
    ],
    maxIterations: 2,
    minScore: 0.86,
    persistPolicy: 'best_effort'
  });

  assert.equal(result.output.title, 'Attempt 2');
  assert.equal(result.evalStatus, 'best_effort');
  assert.equal(result.evalScore, 0.55);
  assert.equal(result.evalAttempts, 2);
  assert.match(result.evalReport.feedback.join('\n'), /Attempt 2 still needs work/);
});

test('shared generation loop rejects schema-invalid output instead of returning it', async () => {
  await assert.rejects(
    () => runGeneratedOutputLoop({
      task: 'test generation',
      outputKind: 'article',
      schema: tinySchema,
      prompt: 'Write a cited article.',
      context: {},
      inference: async () => ({
        output: { title: 'Missing fields' },
        provider: 'test-provider',
        model: 'test-model'
      }),
      evaluators: [passingEvaluator],
      maxIterations: 1
    }),
    /schema-valid/
  );
});

function citedOutput(title) {
  return {
    title,
    body: 'A cited body with a concrete source.',
    citations: [{ title: 'Source', url: 'https://example.com/source', source: 'Example' }]
  };
}

async function passingEvaluator() {
  return passingReport();
}

function passingReport() {
  return {
    score: 1,
    verdict: 'pass',
    assertions: [{ name: 'fixture', text: 'Fixture passed.', passed: true, score: 1 }],
    feedback: [],
    requiredFixes: []
  };
}

function failingReport(score, feedback) {
  return {
    score,
    verdict: 'fail',
    assertions: [{ name: 'fixture', text: feedback[0], passed: false, score }],
    feedback,
    requiredFixes: feedback
  };
}
