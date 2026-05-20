import fs from 'node:fs/promises';
import path from 'node:path';
import { extractKnowledgeModel } from './lib/knowledge-model.mjs';

const root = process.cwd();
const inputPath = path.join(root, 'data', 'summaries', 'latest.json');
const outputDir = path.join(root, 'data', 'knowledge');
const outputPath = path.join(outputDir, 'latest.json');

const ledger = JSON.parse(await fs.readFile(inputPath, 'utf8'));
const model = extractKnowledgeModel(ledger);

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(model, null, 2)}\n`);

console.log(`Wrote ${model.claims.length} claims, ${model.entities.length} entities, and ${model.relationships.length} relationships to data/knowledge/latest.json`);
