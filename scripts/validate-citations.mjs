import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const articlesDir = path.join(root, 'src', 'content', 'articles');
const articleFiles = (await fs.readdir(articlesDir)).filter((file) => file.endsWith('.md'));
const failures = [];

for (const file of articleFiles) {
  const fullPath = path.join(articlesDir, file);
  const text = await fs.readFile(fullPath, 'utf8');
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const frontmatterUrls = [...(frontmatter?.[1] ?? '').matchAll(/url:\s+"([^"]+)"/g)].map((match) => match[1]);
  const bodyUrls = [...body.matchAll(/\]\((https?:\/\/[^)]+)\)/g)].map((match) => match[1]);

  if (frontmatterUrls.length === 0) {
    failures.push(`${file}: missing citation URLs in frontmatter`);
  }

  for (const url of bodyUrls) {
    if (!frontmatterUrls.includes(url)) {
      failures.push(`${file}: body URL is not listed in frontmatter citations: ${url}`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Validated citations for ${articleFiles.length} article(s).`);
