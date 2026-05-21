import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';

const root = process.cwd();
const canonicalEvalPath = path.join(root, 'evals', 'narrator-voice', 'EVAL.yaml');
const targetsPath = path.join(root, '.agentv', 'targets.yaml');
const generatedEvalPath = path.join(root, 'evals', 'narrator-voice', 'narrator-voice.agentv.eval.yaml');

const command = process.argv[2] ?? 'validate';
if (command === 'validate') {
  await validateAndTranslate();
  runAgentv(['validate', generatedEvalPath, targetsPath, '--max-warnings', '0']);
} else if (command === 'run') {
  await validateAndTranslate();
  runAgentv([
    'eval',
    'run',
    generatedEvalPath,
    '--targets',
    targetsPath,
    '--target',
    'tk-technews-narrator-fixtures',
    '--threshold',
    '0.86',
    '--workers',
    '1',
    '--output',
    path.join(root, '.agentv', 'results', 'narrator-voice')
  ]);
} else {
  throw new Error(`Unknown narrator eval command: ${command}`);
}

async function validateAndTranslate() {
  const source = YAML.parse(await fs.readFile(canonicalEvalPath, 'utf8'));
  validateCanonicalEval(source, path.dirname(canonicalEvalPath));
  const translated = translateForAgentV(source);
  await fs.mkdir(path.dirname(generatedEvalPath), { recursive: true });
  await fs.writeFile(generatedEvalPath, YAML.stringify(translated));
}

function validateCanonicalEval(evalFile, evalDir) {
  if (!evalFile || typeof evalFile !== 'object') throw new Error('EVAL.yaml must contain a YAML object.');
  if (!Array.isArray(evalFile.tests) || evalFile.tests.length === 0) throw new Error('EVAL.yaml must define at least one test.');
  for (const test of evalFile.tests) {
    if (!test.id) throw new Error('Every narrator eval test needs an id.');
    const assertions = test.assert ?? test.assertions;
    if (!Array.isArray(assertions) || assertions.length === 0) {
      throw new Error(`Test ${test.id} must use canonical assert entries.`);
    }
    validateAssertions(assertions, evalDir, `tests.${test.id}.assert`);
  }
}

function validateAssertions(assertions, evalDir, location) {
  for (const assertion of assertions) {
    if (!assertion || typeof assertion !== 'object') throw new Error(`${location} entries must be objects.`);
    if (!assertion.name || !assertion.type) throw new Error(`${location} entries require name and type.`);
    const type = assertion.type;
    if (type === 'code_judge' || type === 'code-grader') {
      const script = assertion.script ?? assertion.command;
      if (!script) throw new Error(`${location}.${assertion.name} code_judge requires script or command.`);
      const scriptPath = String(script).split(/\s+/).at(-1);
      if (scriptPath?.endsWith('.mjs') || scriptPath?.endsWith('.js')) {
        assertFileExists(path.join(evalDir, scriptPath), `${location}.${assertion.name}.script`);
      }
    }
    if (type === 'llm_judge' || type === 'llm-grader') {
      const prompt = assertion.prompt;
      if (!prompt) throw new Error(`${location}.${assertion.name} llm_judge requires prompt.`);
      if (String(prompt).startsWith('file://')) {
        assertFileExists(path.join(evalDir, String(prompt).slice('file://'.length)), `${location}.${assertion.name}.prompt`);
      }
    }
    if (type === 'composite') {
      if (!assertion.aggregator) throw new Error(`${location}.${assertion.name} composite requires aggregator.`);
      validateAssertions(assertion.assert ?? assertion.assertions ?? [], evalDir, `${location}.${assertion.name}.assert`);
    }
  }
}

function assertFileExists(filePath, label) {
  if (!existsSync(filePath)) throw new Error(`${label} does not exist: ${filePath}`);
}

function translateForAgentV(value) {
  if (Array.isArray(value)) return value.map((item) => translateForAgentV(item));
  if (!value || typeof value !== 'object') return value;

  const translated = {};
  for (const [key, rawValue] of Object.entries(value)) {
    const nextKey = key === 'assert' ? 'assertions' : key;
    translated[nextKey] = translateForAgentV(rawValue);
  }

  if (translated.type === 'code_judge') translated.type = 'code-grader';
  if (translated.type === 'llm_judge') translated.type = 'llm-grader';
  if (translated.aggregator?.type === 'code_judge') translated.aggregator.type = 'code-grader';
  if (translated.aggregator?.type === 'llm_judge') translated.aggregator.type = 'llm-grader';
  if (translated.type === 'code-grader' && translated.script && !translated.command) {
    translated.command = `node ${translated.script}`;
    delete translated.script;
  }
  return translated;
}

function runAgentv(args) {
  const executable = process.platform === 'win32' ? 'powershell.exe' : 'npx';
  const spawnArgs = process.platform === 'win32'
    ? [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      ['&', psQuote(path.join(root, 'node_modules', '.bin', 'agentv.cmd')), ...args.map(psQuote)].join(' ')
    ]
    : ['agentv', ...args];
  const result = spawnSync(executable, spawnArgs, {
    cwd: root,
    stdio: 'inherit',
    shell: false
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}
