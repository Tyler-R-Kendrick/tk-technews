import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  assertNavigableDailyBriefs,
  DAILY_ARCHIVE_INDEX_PATHS,
  DAILY_CURRENT_ARTIFACT_PATHS,
  dailyArchiveArtifactPaths
} from './daily-archive.mjs';

export const DAILY_ARTIFACT_PATHS = DAILY_CURRENT_ARTIFACT_PATHS;

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
  const navigableBriefs = [];
  const archivePaths = dailyArchiveArtifactPaths(expectedDate);
  for (const relativePath of [...DAILY_CURRENT_ARTIFACT_PATHS, ...archivePaths]) {
    const artifact = JSON.parse(await fs.readFile(path.join(root, relativePath), 'utf8'));
    navigableBriefs.push(artifact);
    if (artifact.date !== expectedDate) {
      throw new Error(`${relativePath} date ${artifact.date} did not match expected ${expectedDate}`);
    }

    const rawTranscriptPath = findRawTranscriptField(artifact);
    if (rawTranscriptPath) {
      throw new Error(`${relativePath} contains raw transcript field at ${rawTranscriptPath}`);
    }
  }

  assertNavigableDailyBriefs(navigableBriefs);

  for (const relativePath of DAILY_ARCHIVE_INDEX_PATHS) {
    const index = JSON.parse(await fs.readFile(path.join(root, relativePath), 'utf8'));
    const day = index.days?.find((entry) => entry?.date === expectedDate);
    if (!day) {
      throw new Error(`${relativePath} did not include archived day ${expectedDate}`);
    }
  }
}

export async function runDailySourceGeneration({
  root = process.cwd(),
  expectedDate = chicagoDate(),
  npm = npmCommand(),
  exec = execFileSync
} = {}) {
  run(exec, 'node', ['scripts/ensure-local-runtime-deps.mjs'], root);
  run(exec, npm, ['run', 'daily:generate'], root);
  await validateDailyArtifacts({ root, expectedDate });
  run(exec, npm, ['run', 'test:daily'], root);
  if (shouldRunFullBuild()) {
    run(exec, npm, ['run', 'build'], root);
  } else {
    console.log('Skipping full Astro build in local Windows automation; daily artifact and route contract checks passed.');
  }

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
  const invocation = commandInvocation(command, args);
  exec(invocation.command, invocation.args, { cwd, stdio: 'inherit', env: repoRuntimeEnv(cwd) });
}

function output(exec, command, args, cwd) {
  const invocation = commandInvocation(command, args);
  return exec(invocation.command, invocation.args, { cwd, encoding: 'utf8', env: repoRuntimeEnv(cwd) });
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

export function shouldRunFullBuild() {
  return process.env.CI === 'true' || process.platform !== 'win32';
}

function commandInvocation(command, args) {
  if (process.platform === 'win32' && /\.cmd$/i.test(command)) {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', command, ...args]
    };
  }

  return { command, args };
}

function repoRuntimeEnv(root) {
  return {
    ...process.env,
    HOME: path.join(root, '.codex-home'),
    XDG_CONFIG_HOME: path.join(root, '.codex-xdg'),
    APPDATA: path.join(root, '.codex-appdata'),
    npm_config_cache: path.join(root, '.npm-cache'),
    ASTRO_TELEMETRY_DISABLED: '1'
  };
}

function isAllowedDailyGeneratedPath(file) {
  const normalized = file.replaceAll('\\', '/');
  return DAILY_CURRENT_ARTIFACT_PATHS.includes(normalized)
    || DAILY_ARCHIVE_INDEX_PATHS.includes(normalized)
    || /^src\/data\/daily\/archive\/\d{4}-\d{2}-\d{2}\.json$/.test(normalized)
    || /^public\/daily\/archive\/\d{4}-\d{2}-\d{2}\.json$/.test(normalized)
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
