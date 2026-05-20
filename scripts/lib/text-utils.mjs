export function slugify(value) {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function stripHtml(value = '') {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function summarizeText(text, maxSentences = 3) {
  const normalized = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return 'No usable text was extracted from this source.';
  }

  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 40);

  return sentences.slice(0, maxSentences).join(' ') || normalized.slice(0, 500);
}

export function frontmatterString(data) {
  return `---\n${toYaml(data)}---\n\n`;
}

function toYaml(value, indent = 0) {
  const pad = ' '.repeat(indent);

  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === 'object' && item !== null) {
        return `${pad}- ${toYamlInlineObject(item, indent + 2)}`;
      }
      return `${pad}- ${formatScalar(item)}\n`;
    }).join('');
  }

  return Object.entries(value).map(([key, entry]) => {
    if (Array.isArray(entry)) {
      return `${pad}${key}:\n${toYaml(entry, indent + 2)}`;
    }
    if (typeof entry === 'object' && entry !== null) {
      return `${pad}${key}:\n${toYaml(entry, indent + 2)}`;
    }
    return `${pad}${key}: ${formatScalar(entry)}\n`;
  }).join('');
}

function toYamlInlineObject(value, indent) {
  const entries = Object.entries(value);
  const [firstKey, firstValue] = entries[0];
  const rest = entries.slice(1);
  const first = `${firstKey}: ${formatScalar(firstValue)}\n`;
  const body = rest.map(([key, entry]) => `${' '.repeat(indent)}${key}: ${formatScalar(entry)}\n`).join('');
  return first + body;
}

function formatScalar(value) {
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(String(value ?? ''));
}
