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

/**
 * Validate the canonical narrator eval YAML and write the AgentV-compatible translated YAML to the generated path.
 *
 * Reads and parses the canonical eval at the configured path, validates its structure and referenced files, translates it
 * into AgentV format, ensures the output directory exists, and writes the translated YAML to the configured generated path.
 *
 * @throws {Error} If validation fails or filesystem operations (read/write/mkdir) fail.
 */
async function validateAndTranslate() {
  const source = YAML.parse(await fs.readFile(canonicalEvalPath, 'utf8'));
  validateCanonicalEval(source, path.dirname(canonicalEvalPath));
  const translated = translateForAgentV(source);
  await fs.mkdir(path.dirname(generatedEvalPath), { recursive: true });
  await fs.writeFile(generatedEvalPath, YAML.stringify(translated));
}

/**
 * Validate a parsed canonical narrator eval YAML structure and its tests.
 * @param {object} evalFile - Parsed YAML object representing the canonical eval configuration.
 * @param {string} evalDir - Filesystem directory containing the canonical eval file (used to resolve file references).
 * @throws {Error} If `evalFile` is not an object.
 * @throws {Error} If `evalFile.tests` is missing or empty.
 * @throws {Error} If any test is missing an `id`.
 * @throws {Error} If any test's assertions are missing or not an array.
 */
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

/**
 * Validate an array of assertion objects and verify any referenced files exist.
 *
 * Iterates the provided assertions and enforces required fields and file references
 * for specific assertion types (code_judge / code-grader, llm_judge / llm-grader, composite).
 *
 * @param {Array<object>} assertions - The assertions to validate.
 * @param {string} evalDir - Directory used to resolve relative file references (scripts, file:// prompts).
 * @param {string} location - Location label used in thrown error messages to identify the assertion path.
 *
 * @throws {Error} If an assertion entry is not an object.
 * @throws {Error} If an assertion is missing required `name` or `type`.
 * @throws {Error} If a `code_judge` / `code-grader` assertion lacks a `script` or `command`.
 * @throws {Error} If a referenced grader script file does not exist.
 * @throws {Error} If an `llm_judge` / `llm-grader` assertion lacks a `prompt`.
 * @throws {Error} If a `file://` prompt references a file that does not exist.
 * @throws {Error} If a `composite` assertion lacks an `aggregator`.
 */
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

/**
 * Ensures a file exists at the given path, throwing an error if it does not.
 * @param {string} filePath - Filesystem path to check.
 * @param {string} label - Human-readable label included in the error message if the file is missing.
 * @throws {Error} If no file exists at `filePath`; message will be "`{label} does not exist: {filePath}`".
 */
function assertFileExists(filePath, label) {
  if (!existsSync(filePath)) throw new Error(`${label} does not exist: ${filePath}`);
}

/**
 * Convert a canonical narrator-eval structure into the AgentV-compatible shape.
 *
 * Recursively maps arrays and objects, renaming the `assert` key to `assertions`,
 * normalizing grader type names (`code_judge` → `code-grader`, `llm_judge` → `llm-grader`),
 * applying the same normalization to `aggregator.type`, and, for `code-grader` entries,
 * turning a `script` field into a `command` of the form `node <script>` when `command` is absent.
 *
 * @param {*} value - Any YAML-parsed value (object, array, or primitive) to translate.
 * @returns {*} The translated value with AgentV-compatible keys and type names.
 */
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

/**
 * Invoke the AgentV CLI with the provided arguments, using a platform-specific spawn strategy.
 *
 * @param {string[]} args - Arguments to pass to the AgentV executable.
 * @throws {Error} If the spawn operation returns an error.
 * Note: the process will exit with AgentV's exit code when AgentV exits with a non-zero status.
 */
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

/**
 * Escape and wrap a value as a PowerShell single-quoted string.
 * Converts the value to a string, doubles any internal single quotes, and surrounds the result with single quotes.
 * @param {*} value - The value to quote.
 * @returns {string} The input converted to a PowerShell-safe single-quoted string (internal `'` doubled).
 */
function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}
