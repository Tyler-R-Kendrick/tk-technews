import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

export const DAILY_ARTIFACT_PATHS = [
  'src/data/daily/generated-daily-articles.json',
  'public/daily/generated-daily-articles.json'
];

export function chicagoDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

export function buildDailyCommitMessage(date) {
  return `chore(daily): update generated artifacts for ${date} [skip ci]`;
}

export function parseChangedFiles({ diffNameOnly = '', untracked = '' } = {}) {
  return [...new Set([
    ...lines(diffNameOnly),
    ...lines(untracked)
  ])];
}

export function assertAllowedCommitPaths(files) {
  const disallowed = files.filter((file) => !isAllowedDailyGeneratedPath(file));
  if (disallowed.length > 0) {
    throw new Error(`Daily generation touched disallowed files: ${disallowed.join(', ')}`);
  }
}

export async function validateDailyArtifacts({ root = process.cwd(), expectedDate = chicagoDate() } = {}) {
  for (const relativePath of DAILY_ARTIFACT_PATHS) {
    const artifact = JSON.parse(await fs.readFile(path.join(root, relativePath), 'utf8'));
    if (artifact.date !== expectedDate) {
      throw new Error(`${relativePath} date ${artifact.date} did not match expected ${expectedDate}`);
    }

    const rawTranscriptPath = findRawTranscriptField(artifact);
    if (rawTranscriptPath) {
      throw new Error(`${relativePath} contains raw transcript field at ${rawTranscriptPath}`);
    }
  }
}

export async function runDailySourceGeneration({
  root = process.cwd(),
  expectedDate = chicagoDate(),
  npm = npmCommand(),
  exec = execFileSync
} = {}) {
  run(exec, npm, ['ci'], root);
  run(exec, npm, ['run', 'daily:generate'], root);
  await validateDailyArtifacts({ root, expectedDate });
  run(exec, npm, ['test'], root);
  run(exec, npm, ['run', 'build'], root);

  const changedFiles = changedFilesSinceHead(exec, root);
  assertAllowedCommitPaths(changedFiles);

  if (changedFiles.length === 0) {
    console.log('Daily source generation produced no repository changes.');
    return { status: 'no_changes', changedFiles };
  }

  run(exec, 'git', ['config', 'user.name', 'github-actions[bot]'], root);
  run(exec, 'git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], root);
  run(exec, 'git', ['add', '--', ...changedFiles], root);
  run(exec, 'git', ['commit', '-m', buildDailyCommitMessage(expectedDate)], root);
  run(exec, 'git', ['push', 'origin', 'HEAD:main'], root);

  return { status: 'committed', changedFiles };
}

function changedFilesSinceHead(exec, root) {
  return parseChangedFiles({
    diffNameOnly: output(exec, 'git', ['diff', '--name-only', 'HEAD', '--'], root),
    untracked: output(exec, 'git', ['ls-files', '--others', '--exclude-standard'], root)
  });
}

function run(exec, command, args, cwd) {
  console.log(`$ ${[command, ...args].join(' ')}`);
  exec(command, args, { cwd, stdio: 'inherit' });
}

function output(exec, command, args, cwd) {
  return exec(command, args, { cwd, encoding: 'utf8' });
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function isAllowedDailyGeneratedPath(file) {
  const normalized = file.replaceAll('\\', '/');
  return DAILY_ARTIFACT_PATHS.includes(normalized)
    || /^src\/data\/precompiled\/[^/]+\.json$/.test(normalized);
}

function findRawTranscriptField(value, currentPath = '') {
  if (!value || typeof value !== 'object') return null;

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findRawTranscriptField(value[index], joinObjectPath(currentPath, String(index)));
      if (found) return found;
    }
    return null;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const nestedPath = joinObjectPath(currentPath, key);
    if (key === 'transcript' || key === 'transcriptText') return nestedPath;
    const found = findRawTranscriptField(nestedValue, nestedPath);
    if (found) return found;
  }

  return null;
}

function joinObjectPath(parent, key) {
  return parent ? `${parent}.${key}` : key;
}

function lines(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}
