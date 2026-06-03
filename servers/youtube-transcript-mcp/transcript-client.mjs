import { spawn } from 'node:child_process';

const PYTHON_HELPER = 'servers/youtube-transcript-mcp/transcript_tool.py';

export function extractYouTubeVideoId(input) {
  const value = String(input ?? '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;

  const url = new URL(value);
  if (url.hostname === 'youtu.be') {
    return url.pathname.split('/').filter(Boolean)[0];
  }

  const watchId = url.searchParams.get('v');
  if (watchId) return watchId;

  const embedMatch = url.pathname.match(/\/(?:embed|shorts)\/([A-Za-z0-9_-]{11})/);
  if (embedMatch) return embedMatch[1];

  throw new Error(`Could not extract a YouTube video id from: ${input}`);
}

export function normalizeLanguages(languages) {
  if (!languages) return ['en'];
  if (Array.isArray(languages)) {
    return languages.map((language) => String(language).trim()).filter(Boolean);
  }
  return String(languages)
    .split(',')
    .map((language) => language.trim())
    .filter(Boolean);
}

export function buildPythonInvocation(input) {
  const python = process.env.PYTHON || 'python';
  const payload = {
    ...input,
    video_id: extractYouTubeVideoId(input.idOrUrl ?? input.video_id),
    languages: normalizeLanguages(input.languages)
  };
  delete payload.idOrUrl;

  return {
    command: python,
    args: [PYTHON_HELPER],
    stdin: JSON.stringify(payload)
  };
}

export async function callTranscriptTool(input) {
  const invocation = buildPythonInvocation(input);
  const result = await runProcess(invocation, {
    timeoutMs: Number(input.timeoutMs ?? 20000)
  });

  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `Transcript helper exited with code ${result.exitCode}`);
  }

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`Transcript helper returned invalid JSON: ${error.message}`);
  }
}

export function toMcpJson(value) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

export function runProcess({ command, args, stdin }, { timeoutMs } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? setTimeout(() => {
          if (settled) return;
          settled = true;
          child.kill();
          resolve({
            exitCode: -1,
            stdout,
            stderr: stderr || `Transcript helper timed out after ${timeoutMs}ms`
          });
        }, timeoutMs)
      : null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (exitCode) => {
      finish({ exitCode, stdout, stderr });
    });
    child.on('error', (error) => {
      finish({
        exitCode: -1,
        stdout,
        stderr: error.message
      });
    });
    child.stdin.end(stdin);
  });
}
