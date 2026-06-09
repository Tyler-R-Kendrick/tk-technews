// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
// The published @agentv/core package currently depends on workspace:* packages.
import { runDailySocialFixture } from './agentv-daily-social-provider.mjs';

test('AgentV TypeScript SDK eval catches source-grounding fail-closed behavior', async () => {
  const { evaluate } = await loadAgentvEvaluate();
  const { results, summary } = await evaluate({
    task: async (input: string) => {
      const fixtureId = String(input).includes('source-grounding-regression')
        ? 'source-grounding-regression'
        : 'retweet-quote';
      return JSON.stringify(await runDailySocialFixture(fixtureId));
    },
    tests: [
      {
        id: 'source-grounding-sdk-regression',
        input: 'fixture: source-grounding-regression',
        assert: [
          ({ output }: { output: string }) => {
            const candidate = JSON.parse(output);
            const stub = candidate.stub;
            const generatedText = [
              stub?.dek,
              ...(stub?.bodySections ?? []).flatMap((section: { heading?: string; paragraphs?: string[] }) => [
                section.heading,
                ...(section.paragraphs ?? [])
              ]),
              ...(stub?.keyTakeaways ?? [])
            ].filter(Boolean).join('\n');
            const requiredFixes = stub?.evalReport?.requiredFixes ?? [];
            const passed = stub?.evalStatus === 'best_effort'
              && stub?.status === 'best_effort'
              && requiredFixes.some((fix: string) => /usable extracted source text|usable source|grounded/i.test(fix))
              && !/measurement problem|source set|daily feed|cited source signal|if this source is accurate/i.test(generatedText);

            return {
              name: 'source-grounding fail-closed contract',
              score: passed ? 1 : 0,
              metadata: {
                evalStatus: stub?.evalStatus,
                requiredFixes
              }
            };
          }
        ]
      }
    ],
    workers: 1,
    maxRetries: 0
  });

  assert.equal(summary.failed, 0, JSON.stringify(results, null, 2));
  assert.equal(summary.passed, 1);
});

async function loadAgentvEvaluate() {
  const distDir = path.join(process.cwd(), 'node_modules', 'agentv', 'dist');
  const entries = await fs.readdir(distDir);
  const chunkFiles = entries
    .filter((entry) => /^chunk-.*\.js$/.test(entry))
    .sort();

  for (const file of chunkFiles) {
    const source = await fs.readFile(path.join(distDir, file), 'utf8');
    if (!/\bevaluate\b/.test(source) || !/runEvaluation|loadTsEvalSuite/.test(source)) {
      continue;
    }

    const module = await import(pathToFileURL(path.join(distDir, file)).href);
    if (typeof module.evaluate === 'function') {
      return { evaluate: module.evaluate };
    }
  }

  throw new Error(`Could not locate agentv evaluate() export under ${distDir}`);
}
