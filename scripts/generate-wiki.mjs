import { generateWikiFromKnowledgeGraph } from './lib/wiki-generator.mjs';

const wiki = await generateWikiFromKnowledgeGraph({
  root: process.cwd()
});

console.log(`Generated knowledge graph wiki: ${wiki.pages.length} page(s), graph ${wiki.graphHash}`);
console.log('Wrote src/data/wiki/generated-wiki.json and public/wiki/generated-wiki.json');
