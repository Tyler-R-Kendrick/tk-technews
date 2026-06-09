import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertAllowedCommitPaths,
  buildDailyCommitMessage,
  chicagoDate,
  parseChangedFiles,
  runDailySourceGeneration,
  shouldRunFullBuild,
  validateDailyArtifacts
} from './daily-source-generation-runner.mjs';

test('allows only daily generated artifacts and precompiled json files', () => {
  assert.doesNotThrow(() => assertAllowedCommitPaths([
    'src/data/precompiled/source-index.json',
    'src/data/precompiled/youtube-latest.json',
    'src/data/daily/generated-daily-articles.json',
    'public/daily/generated-daily-articles.json',
    'src/data/daily/archive-index.json',
    'public/daily/archive-index.json',
    'src/data/daily/archive/2026-05-22.json',
    'public/daily/archive/2026-05-22.json'
  ]));

  assert.throws(
    () => assertAllowedCommitPaths(['package.json']),
    /Daily generation touched disallowed files: package\.json/
  );
});

test('parseChangedFiles combines tracked and untracked paths', () => {
  assert.deepEqual(parseChangedFiles({
    diffNameOnly: 'src/data/precompiled/source-index.json\n',
    untracked: 'public/daily/generated-daily-articles.json\npublic/daily/archive/2026-05-22.json\n'
  }), [
    'src/data/precompiled/source-index.json',
    'public/daily/generated-daily-articles.json',
    'public/daily/archive/2026-05-22.json'
  ]);
});

test('validateDailyArtifacts rejects date mismatches', async () => {
  const root = await tempRoot();
  await writeJson(root, 'src/data/daily/generated-daily-articles.json', {
    date: '2026-05-21',
    articleStubs: []
  });
  await writeJson(root, 'public/daily/generated-daily-articles.json', {
    date: '2026-05-22',
    articleStubs: []
  });
  await writeJson(root, 'src/data/daily/archive/2026-05-22.json', {
    date: '2026-05-22',
    articleStubs: []
  });
  await writeJson(root, 'public/daily/archive/2026-05-22.json', {
    date: '2026-05-22',
    articleStubs: []
  });
  await writeJson(root, 'src/data/daily/archive-index.json', { days: [{ date: '2026-05-22' }] });
  await writeJson(root, 'public/daily/archive-index.json', { days: [{ date: '2026-05-22' }] });

  await assert.rejects(
    () => validateDailyArtifacts({ root, expectedDate: '2026-05-22' }),
    /src\/data\/daily\/generated-daily-articles\.json date 2026-05-21 did not match expected 2026-05-22/
  );
});

test('validateDailyArtifacts rejects raw transcript payloads', async () => {
  const root = await tempRoot();
  const payload = {
    date: '2026-05-22',
    articleStubs: [
      {
        sources: [
          {
            title: 'Video',
            transcript: { status: 'ok', text: 'raw words' }
          }
        ]
      }
    ]
  };
  await writeJson(root, 'src/data/daily/generated-daily-articles.json', payload);
  await writeJson(root, 'public/daily/generated-daily-articles.json', payload);
  await writeJson(root, 'src/data/daily/archive/2026-05-22.json', payload);
  await writeJson(root, 'public/daily/archive/2026-05-22.json', payload);
  await writeJson(root, 'src/data/daily/archive-index.json', { days: [{ date: '2026-05-22' }] });
  await writeJson(root, 'public/daily/archive-index.json', { days: [{ date: '2026-05-22' }] });

  await assert.rejects(
    () => validateDailyArtifacts({ root, expectedDate: '2026-05-22' }),
    /contains raw transcript field at articleStubs\.0\.sources\.0\.transcript/
  );
});

test('commit message uses the generated daily date', () => {
  assert.equal(
    buildDailyCommitMessage('2026-05-22'),
    'chore(daily): update generated artifacts for 2026-05-22 [skip ci]'
  );
});

test('chicagoDate formats the America Chicago calendar day', () => {
  assert.equal(chicagoDate(new Date('2026-05-22T11:30:00.000Z')), '2026-05-22');
});

test('runner exits without committing when generation produces no changes', async () => {
  const root = await rootWithValidArtifacts();
  const calls = [];
  const exec = fakeExec(calls, {
    'git diff --name-only HEAD --': '',
    'git ls-files --others --exclude-standard': ''
  });

  const result = await runDailySourceGeneration({ root, expectedDate: '2026-05-22', npm: 'npm', exec });

  assert.equal(result.status, 'no_changes');
  assert.ok(calls.some((call) => call.command === 'node' && call.args.join(' ') === 'scripts/ensure-local-runtime-deps.mjs'));
  assert.ok(calls.some((call) => call.command === 'npm' && call.args.join(' ') === 'run daily:generate'));
  assert.ok(calls.some((call) => call.command === 'npm' && call.args.join(' ') === 'run test:daily'));
  assert.equal(calls.some((call) => call.command === 'npm' && call.args.join(' ') === 'run build'), shouldRunFullBuild());
  assert.ok(!calls.some((call) => call.command === 'git' && call.args[0] === 'commit'));
});

test('runner commits and pushes allowed generated artifact changes', async () => {
  const root = await rootWithValidArtifacts();
  const calls = [];
  const exec = fakeExec(calls, {
    'git diff --name-only HEAD --': 'src/data/precompiled/source-index.json\nsrc/data/daily/generated-daily-articles.json\nsrc/data/daily/archive-index.json\nsrc/data/daily/archive/2026-05-22.json\n',
    'git ls-files --others --exclude-standard': ''
  });

  const result = await runDailySourceGeneration({ root, expectedDate: '2026-05-22', npm: 'npm', exec });

  assert.equal(result.status, 'committed');
  assert.equal(calls.some((call) => call.command === 'npm' && call.args.join(' ') === 'run build'), shouldRunFullBuild());
  assert.ok(calls.some((call) => call.command === 'git' && call.args.join(' ') === 'add -- src/data/precompiled/source-index.json src/data/daily/generated-daily-articles.json src/data/daily/archive-index.json src/data/daily/archive/2026-05-22.json'));
  assert.ok(calls.some((call) => call.command === 'git' && call.args.join(' ') === 'commit -m chore(daily): update generated artifacts for 2026-05-22 [skip ci]'));
  assert.ok(calls.some((call) => call.command === 'git' && call.args.join(' ') === 'push origin HEAD:main'));
});

test('runner fails before commit when generation touches disallowed files', async () => {
  const root = await rootWithValidArtifacts();
  const calls = [];
  const exec = fakeExec(calls, {
    'git diff --name-only HEAD --': 'package.json\n',
    'git ls-files --others --exclude-standard': ''
  });

  await assert.rejects(
    () => runDailySourceGeneration({ root, expectedDate: '2026-05-22', npm: 'npm', exec }),
    /Daily generation touched disallowed files: package\.json/
  );
  assert.ok(!calls.some((call) => call.command === 'git' && call.args[0] === 'commit'));
});

test('validateDailyArtifacts rejects non-navigable archived article hrefs', async () => {
  const root = await tempRoot();
  const payload = {
    date: '2026-05-22',
    articleStubs: [{ slug: 'lead-story', title: 'Lead Story', href: '/daily/2026-05-21/lead-story/' }]
  };
  await writeJson(root, 'src/data/daily/generated-daily-articles.json', payload);
  await writeJson(root, 'public/daily/generated-daily-articles.json', payload);
  await writeJson(root, 'src/data/daily/archive/2026-05-22.json', payload);
  await writeJson(root, 'public/daily/archive/2026-05-22.json', payload);
  await writeJson(root, 'src/data/daily/archive-index.json', { days: [{ date: '2026-05-22' }] });
  await writeJson(root, 'public/daily/archive-index.json', { days: [{ date: '2026-05-22' }] });

  await assert.rejects(
    () => validateDailyArtifacts({ root, expectedDate: '2026-05-22' }),
    /unexpected href/
  );
});

async function tempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'daily-source-runner-'));
}

async function rootWithValidArtifacts() {
  const root = await tempRoot();
  const payload = { date: '2026-05-22', articleStubs: [] };
  await writeJson(root, 'src/data/daily/generated-daily-articles.json', payload);
  await writeJson(root, 'public/daily/generated-daily-articles.json', payload);
  await writeJson(root, 'src/data/daily/archive/2026-05-22.json', payload);
  await writeJson(root, 'public/daily/archive/2026-05-22.json', payload);
  await writeJson(root, 'src/data/daily/archive-index.json', { days: [{ date: '2026-05-22' }] });
  await writeJson(root, 'public/daily/archive-index.json', { days: [{ date: '2026-05-22' }] });
  return root;
}

async function writeJson(root, relativePath, value) {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function fakeExec(calls, outputs = {}) {
  return (command, args, options = {}) => {
    calls.push({ command, args, options });
    const key = `${command} ${args.join(' ')}`;
    if (options.encoding) return outputs[key] ?? '';
    return undefined;
  };
}
