import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://tyler-r-kendrick.github.io',
  base: '/tk-technews',
  markdown: {
    shikiConfig: {
      theme: 'github-light'
    }
  }
});
