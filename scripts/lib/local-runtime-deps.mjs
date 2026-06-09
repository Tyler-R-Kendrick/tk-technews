import fs from 'node:fs';
import path from 'node:path';

const BASE_NODE_MODULES_DONORS = [
  'C:\\src\\tk-technews\\node_modules'
];

const PACKAGE_DONORS = {
  agentv: [
    'C:\\src\\Prophetic\\node_modules\\agentv',
    'C:\\src\\agent-harness\\_codex_temp_security_3c14_c\\node_modules\\agentv'
  ],
  '@earendil-works/pi-ai': [
    'C:\\src\\Prophetic\\node_modules\\@earendil-works\\pi-ai'
  ],
  '@esbuild/win32-arm64': [
    'C:\\src\\qdai\\corp-landing\\node_modules\\@esbuild\\win32-arm64',
    'C:\\src\\vessel\\node_modules\\@esbuild\\win32-arm64'
  ],
  '@rollup/rollup-win32-arm64-msvc': [
    'C:\\src\\Prophetic\\node_modules\\@rollup\\rollup-win32-arm64-msvc',
    'C:\\src\\vessel\\node_modules\\@rollup\\rollup-win32-arm64-msvc',
    'C:\\src\\corp-landing\\node_modules\\@rollup\\rollup-win32-arm64-msvc'
  ]
};

const REQUIRED_PACKAGES = [
  {
    name: '@earendil-works/pi-ai',
    relativePath: path.join('node_modules', '@earendil-works', 'pi-ai'),
    isHealthy: (root) => {
      const packageJson = readPackageJson(path.join(root, 'node_modules', '@earendil-works', 'pi-ai', 'package.json'));
      return packageJson?.version?.startsWith('0.74.')
        && fileExists(path.join(root, 'node_modules', '@earendil-works', 'pi-ai', 'dist', 'index.js'));
    }
  },
  {
    name: 'agentv',
    relativePath: path.join('node_modules', 'agentv'),
    isHealthy: (root) => {
      const packageJson = readPackageJson(path.join(root, 'node_modules', 'agentv', 'package.json'));
      if (!packageJson?.version?.startsWith('4.')) return false;
      return fileExists(path.join(root, 'node_modules', 'agentv', 'dist', 'index.js'));
    }
  },
  {
    name: '@esbuild/win32-arm64',
    relativePath: path.join('node_modules', '@esbuild', 'win32-arm64'),
    isHealthy: (root) => {
      const packageJson = readPackageJson(path.join(root, 'node_modules', '@esbuild', 'win32-arm64', 'package.json'));
      return packageJson?.version === '0.27.7';
    }
  },
  {
    name: '@rollup/rollup-win32-arm64-msvc',
    relativePath: path.join('node_modules', '@rollup', 'rollup-win32-arm64-msvc'),
    isHealthy: (root) => {
      const packageJson = readPackageJson(path.join(root, 'node_modules', '@rollup', 'rollup-win32-arm64-msvc', 'package.json'));
      return typeof packageJson?.version === 'string'
        && /^4\.60\./.test(packageJson.version)
        && fileExists(path.join(root, 'node_modules', '@rollup', 'rollup-win32-arm64-msvc', 'rollup.win32-arm64-msvc.node'));
    }
  }
];

export function repoRuntimeEnv(root = process.cwd()) {
  return {
    ...process.env,
    HOME: path.join(root, '.codex-home'),
    XDG_CONFIG_HOME: path.join(root, '.codex-xdg'),
    APPDATA: path.join(root, '.codex-appdata'),
    npm_config_cache: path.join(root, '.npm-cache'),
    ASTRO_TELEMETRY_DISABLED: '1'
  };
}

export function ensureLocalRuntimeDeps(root = process.cwd()) {
  const repairs = [];
  ensureRuntimeDirs(root);

  const hydrated = hydrateBaseNodeModules(root);
  if (hydrated) {
    repairs.push(`hydrated base node_modules from ${hydrated}`);
  }

  for (const dependency of REQUIRED_PACKAGES) {
    if (dependency.isHealthy(root)) continue;
    const donor = PACKAGE_DONORS[dependency.name]?.find((candidate) => fileExists(candidate));
    if (!donor) {
      throw new Error(`Missing donor for ${dependency.name}; checked ${PACKAGE_DONORS[dependency.name]?.join(', ')}`);
    }

    copyDir(donor, path.join(root, dependency.relativePath));
    if (!dependency.isHealthy(root)) {
      throw new Error(`Dependency repair for ${dependency.name} from ${donor} did not produce a healthy install`);
    }
    repairs.push(`repaired ${dependency.name} from ${donor}`);
  }

  return { repairs };
}

function ensureRuntimeDirs(root) {
  for (const directory of [
    '.codex-home',
    '.codex-xdg',
    '.codex-appdata',
    '.npm-cache'
  ]) {
    fs.mkdirSync(path.join(root, directory), { recursive: true });
  }
}

function hydrateBaseNodeModules(root) {
  for (const donor of BASE_NODE_MODULES_DONORS) {
    if (!fileExists(donor)) continue;
    copyDir(donor, path.join(root, 'node_modules'));
    if (fileExists(path.join(root, 'node_modules', '.bin', 'astro.cmd'))
      && fileExists(path.join(root, 'node_modules', 'astro', 'dist', 'cli', 'index.js'))
      && fileExists(path.join(root, 'node_modules', 'aria-query', 'lib', 'index.js'))
      && fileExists(path.join(root, 'node_modules', 'axobject-query', 'lib', 'index.js'))) {
      return donor;
    }
  }

  throw new Error(`Could not hydrate a healthy base node_modules from donors: ${BASE_NODE_MODULES_DONORS.join(', ')}`);
}

function copyDir(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, force: true, dereference: true });
}

function readPackageJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function fileExists(filePath) {
  return fs.existsSync(filePath);
}
