import { persistWeeklyLedgerToKnowledgeGraph } from './lib/weekly-graph-persistence.mjs';

const result = await persistWeeklyLedgerToKnowledgeGraph({
  root: process.cwd()
});

console.log(`Persisted weekly ledger to knowledge graph: ${result.sourceDocs} source docs, ${result.claims} claims, ${result.entities} entities, ${result.topics} topics, ${result.relationships} relationships.`);
