const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

export function requireCredentials(env = process.env, options = {}) {
  const apiKey = env.YOUTUBE_API_KEY;
  const oauthToken = env.YOUTUBE_OAUTH_TOKEN;

  if (!apiKey) {
    throw new Error('YOUTUBE_API_KEY is required for YouTube Data API metadata tools.');
  }

  if (options.needsOAuth && !oauthToken) {
    throw new Error('YOUTUBE_OAUTH_TOKEN is required for YouTube captions tools.');
  }

  return { apiKey, oauthToken };
}

export function buildYouTubeUrl(resource, params = {}) {
  const url = new URL(`${YOUTUBE_API_BASE}/${resource}`);

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }

  return url;
}

export async function callYouTube(resource, params = {}, options = {}) {
  const credentials = requireCredentials(process.env, options);
  const url = buildYouTubeUrl(resource, {
    ...params,
    key: credentials.apiKey
  });
  const headers = {};

  if (options.needsOAuth) {
    headers.authorization = `Bearer ${credentials.oauthToken}`;
  }

  const response = await fetch(url, { headers });
  const text = await response.text();
  const payload = parseMaybeJson(text);

  if (!response.ok) {
    const detail = payload?.error?.message || payload?.error || text || `HTTP ${response.status}`;
    throw new Error(`YouTube Data API ${resource} failed: ${detail}`);
  }

  return payload;
}

export async function downloadCaptionTrack({ id, tfmt, tlang }) {
  const credentials = requireCredentials(process.env, { needsOAuth: true });
  const url = buildYouTubeUrl('captions/download', {
    id,
    tfmt,
    tlang,
    key: credentials.apiKey
  });

  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${credentials.oauthToken}`
    }
  });
  const text = await response.text();

  if (!response.ok) {
    const payload = parseMaybeJson(text);
    const detail = payload?.error?.message || payload?.error || text || `HTTP ${response.status}`;
    throw new Error(`YouTube Data API captions.download failed: ${detail}`);
  }

  return {
    id,
    tfmt: tfmt ?? null,
    tlang: tlang ?? null,
    text
  };
}

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

function parseMaybeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
