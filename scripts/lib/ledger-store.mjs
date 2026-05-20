import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const LEDGER_DIR = path.join('data', 'ledger');

export function canonicalizeUri(uri) {
  const url = new URL(String(uri).trim());
  url.hash = '';
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();

  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
    url.port = '';
  }

  const sortedParams = [...url.searchParams.entries()]
    .sort(([left], [right]) => left.localeCompare(right));
  url.search = '';
  for (const [key, value] of sortedParams) {
    url.searchParams.append(key, value);
  }

  return url.toString();
}

export function stableHash(value, length = 16) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, length);
}

export function sourceDocIdForUri(uri) {
  return `source-doc:${stableHash(canonicalizeUri(uri))}`;
}

export async function ensureLedgerDir(root) {
  await fs.mkdir(path.join(root, LEDGER_DIR), { recursive: true });
}

export function ledgerPath(root, ledgerName) {
  return path.join(root, LEDGER_DIR, `${ledgerName}.jsonl`);
}

export async function appendLedgerRecord(root, ledgerName, record) {
  await ensureLedgerDir(root);
  await fs.appendFile(ledgerPath(root, ledgerName), `${JSON.stringify(record)}\n`);
  return record;
}

export async function readLedger(root, ledgerName) {
  try {
    const text = await fs.readFile(ledgerPath(root, ledgerName), 'utf8');
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

export async function latestRecordById(root, ledgerName, id) {
  const records = await readLedger(root, ledgerName);
  for (let index = records.length - 1; index >= 0; index -= 1) {
    if (records[index].id === id) return records[index];
  }
  return null;
}

export async function latestRecordWhere(root, ledgerName, predicate) {
  const records = await readLedger(root, ledgerName);
  for (let index = records.length - 1; index >= 0; index -= 1) {
    if (predicate(records[index])) return records[index];
  }
  return null;
}

export async function appendRelation(root, relation) {
  return appendLedgerRecord(root, 'relations', relation);
}

export function nowIso(now = undefined) {
  return now ?? new Date().toISOString();
}
