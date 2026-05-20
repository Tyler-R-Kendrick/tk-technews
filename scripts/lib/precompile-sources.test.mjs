import test from 'node:test';
import assert from 'node:assert/strict';
import {
  anthropicNewsSource,
  anthropicResearchSource,
  enrichYouTubeItemsWithTranscripts,
  flattenYouTubeSources,
  githubOrganizationSources,
  googleResearchBlogSource,
  googleNewsRssUrl,
  huggingFaceDailyPapersApiUrl,
  huggingFaceDailyPapersSource,
  metaAiResearchSource,
  metaResearchFeedSources,
  monitoredSourceSummary,
  normalizeAnthropicNewsItems,
  normalizeAnthropicResearchItems,
  normalizeGitHubOrganizationRepos,
  normalizeGoogleResearchBlogItems,
  normalizeHuggingFaceDailyPapers,
  normalizeMetaAiResearchItems,
  normalizeMetaResearchFeedItems,
  normalizePublicationFeedItems,
  normalizePublicationRssXml,
  normalizeTwitterProfileRssXml,
  normalizeYouTubeHandle,
  normalizeVercelAnnouncementItems,
  normalizeXaiResearchFeedItems,
  publicationFeedSources,
  twitterProfileSources,
  vercelAnnouncementSources,
  xaiResearchFeedSources
} from './precompile-sources.mjs';
import monitoredSources from '../../data/monitored-sources.json' with { type: 'json' };

test('monitored source catalog contains requested category and topic counts', () => {
  const summary = monitoredSourceSummary(monitoredSources);

  assert.deepEqual(summary.youtubeCategories, {
    news: 7,
    dev: 14,
    academics: 13
  });
  assert.equal(summary.youtubeTotal, 34);
  assert.equal(summary.googleNewsTopics, 32);
  assert.equal(summary.huggingFaceDailyPapers, true);
  assert.equal(summary.googleResearchBlog, true);
  assert.equal(summary.anthropicResearch, true);
  assert.equal(summary.anthropicNews, true);
  assert.equal(summary.vercelAnnouncementFeeds, 2);
  assert.equal(summary.githubOrganizations, 1);
  assert.equal(summary.metaResearchFeeds, 1);
  assert.equal(summary.metaAiResearch, true);
  assert.equal(summary.publicationFeeds, 2);
  assert.equal(summary.xaiResearchFeeds, 2);
  assert.equal(summary.twitterProfiles, 31);
});

test('flattens YouTube sources with category metadata and handle URLs', () => {
  const flattened = flattenYouTubeSources({ news: ['Fireship'], dev: ['OpenAI'] });

  assert.deepEqual(flattened, [
    {
      id: 'youtube-news-fireship',
      category: 'news',
      handle: 'Fireship',
      normalizedHandle: 'Fireship',
      channelUrl: 'https://www.youtube.com/@Fireship'
    },
    {
      id: 'youtube-dev-openai',
      category: 'dev',
      handle: 'OpenAI',
      normalizedHandle: 'OpenAI',
      channelUrl: 'https://www.youtube.com/@OpenAI'
    }
  ]);
});

test('normalizes YouTube handles without losing hyphenated names', () => {
  assert.equal(normalizeYouTubeHandle('@neuro-dump'), 'neuro-dump');
  assert.equal(normalizeYouTubeHandle(' Matthew_Berman '), 'Matthew_Berman');
});

test('enriches YouTube feed items with fetched transcript summaries', async () => {
  const items = await enrichYouTubeItemsWithTranscripts([
    {
      title: 'Phase Transitions in Agent Memory: Recurrent Memory',
      link: 'https://www.youtube.com/watch?v=lPKOJxfsGG4',
      id: 'yt:video:lPKOJxfsGG4',
      publishedAt: '2026-05-20T13:15:14.000Z',
      summary: ''
    }
  ], {
    transcriptFetcher: async ({ idOrUrl, format }) => {
      assert.equal(idOrUrl, 'https://www.youtube.com/watch?v=lPKOJxfsGG4');
      assert.equal(format, 'text');
      return {
        video_id: 'lPKOJxfsGG4',
        language_code: 'en',
        is_generated: true,
        transcript: 'Hello, community. Today we talk about memory. The main study introduces recurrence based memory for long-running LLM agents. Recurrent memory changes how agents retain task state over long horizons and affects evaluation.'
      };
    }
  });

  assert.equal(items[0].transcript.videoId, 'lPKOJxfsGG4');
  assert.equal(items[0].transcript.status, 'ok');
  assert.match(items[0].transcriptSummary, /recurrence based memory for long-running LLM agents/);
  assert.match(items[0].transcriptSummary, /Recurrent memory changes how agents retain task state/);
  assert.notEqual(items[0].summary, 'No usable text was extracted from this source.');
});

test('builds Google News RSS URLs for topic tracking', () => {
  assert.equal(
    googleNewsRssUrl('engineering at meta'),
    'https://news.google.com/rss/search?q=engineering+at+meta&hl=en-US&gl=US&ceid=US%3Aen'
  );
});

test('builds Hugging Face Daily Papers source metadata', () => {
  assert.equal(
    huggingFaceDailyPapersApiUrl({ date: '2026-05-20', limit: 20 }),
    'https://huggingface.co/api/daily_papers?p=0&limit=20&date=2026-05-20&sort=publishedAt'
  );

  assert.deepEqual(huggingFaceDailyPapersSource({ date: '2026-05-20', limit: 5 }), {
    id: 'huggingface-daily-papers-2026-05-20',
    category: 'academics',
    date: '2026-05-20',
    limit: 5,
    title: 'Hugging Face Daily Papers',
    sourceUrl: 'https://huggingface.co/papers/date/2026-05-20',
    apiUrl: 'https://huggingface.co/api/daily_papers?p=0&limit=5&date=2026-05-20&sort=publishedAt'
  });
});

test('normalizes Hugging Face Daily Papers for static display', () => {
  const papers = normalizeHuggingFaceDailyPapers([
    {
      paper: {
        id: '2605.16403',
        title: 'When Vision Speaks for Sound',
        publishedAt: '2026-05-13T00:00:00Z',
        submittedOnDailyAt: '2026-05-20T00:00:00Z',
        authors: [
          { name: 'Xiaofei Wen', hidden: false },
          { name: 'Hidden Author', hidden: true },
          { name: 'Wenjie Jacky Mo', hidden: false }
        ],
        ai_summary: 'Vision cues can drive apparent audio understanding.',
        upvotes: 61,
        githubRepo: 'https://github.com/rakanWen/wvs-code',
        ai_keywords: ['audio-visual alignment']
      },
      thumbnail: 'https://cdn-thumbnails.huggingface.co/social-thumbnails/papers/2605.16403.png',
      numComments: 1
    }
  ]);

  assert.deepEqual(papers, [
    {
      title: 'When Vision Speaks for Sound',
      link: 'https://huggingface.co/papers/2605.16403',
      id: '2605.16403',
      publishedAt: '2026-05-13T00:00:00Z',
      submittedAt: '2026-05-20T00:00:00Z',
      author: 'Xiaofei Wen, Wenjie Jacky Mo',
      authors: ['Xiaofei Wen', 'Wenjie Jacky Mo'],
      summary: 'Vision cues can drive apparent audio understanding.',
      upvotes: 61,
      comments: 1,
      thumbnail: 'https://cdn-thumbnails.huggingface.co/social-thumbnails/papers/2605.16403.png',
      projectPage: null,
      githubRepo: 'https://github.com/rakanWen/wvs-code',
      keywords: ['audio-visual alignment']
    }
  ]);
});

test('builds Google Research Blog source metadata', () => {
  assert.deepEqual(googleResearchBlogSource({ limit: 6 }), {
    id: 'google-research-blog',
    category: 'research',
    title: 'Google Research Blog',
    sourceUrl: 'https://research.google/blog/',
    rssUrl: 'https://research.google/blog/rss/',
    limit: 6
  });
});

test('normalizes Google Research Blog RSS items for static display', () => {
  const items = normalizeGoogleResearchBlogItems([
    {
      title: 'Four ways Google Research scientists use empirical research assistance',
      link: 'https://research.google/blog/four-ways-google-research-scientists-have-been-using-empirical-research-assistance/',
      guid: 'research-google-example',
      isoDate: '2026-04-29T16:00:00.000Z',
      creator: 'Google Research',
      contentSnippet: 'A short article summary.',
      categories: ['Generative AI', 'Machine Intelligence']
    }
  ]);

  assert.deepEqual(items, [
    {
      title: 'Four ways Google Research scientists use empirical research assistance',
      link: 'https://research.google/blog/four-ways-google-research-scientists-have-been-using-empirical-research-assistance/',
      id: 'research-google-example',
      publishedAt: '2026-04-29T16:00:00.000Z',
      author: 'Google Research',
      summary: 'A short article summary.',
      categories: ['Generative AI', 'Machine Intelligence']
    }
  ]);
});

test('builds Anthropic Research source metadata', () => {
  assert.deepEqual(anthropicResearchSource({ limit: 6 }), {
    id: 'anthropic-research',
    category: 'research',
    title: 'Anthropic Research',
    sourceUrl: 'https://www.anthropic.com/research',
    limit: 6
  });
});

test('normalizes Anthropic Research publication cards from HTML', () => {
  const html = `
    <a href="/research/2028-ai-leadership" class="listItem">
      <div class="meta">
        <time class="date">May 14, 2026</time>
        <span class="subject">Policy</span>
      </div>
      <span class="title">2028: Two scenarios for global AI leadership</span>
    </a>
    <a href="/research/natural-language-autoencoders" class="content">
      <h2 class="featuredTitle">Natural Language Autoencoders: Turning Claude's thoughts into text</h2>
      <div class="meta">
        <span class="caption bold">Interpretability</span>
        <time class="date caption bold">May 7, 2026</time>
      </div>
      <p>AI models like Claude talk in words but think in numbers.</p>
    </a>
    <a href="/research/team/alignment">Alignment</a>
  `;

  assert.deepEqual(normalizeAnthropicResearchItems(html), [
    {
      title: '2028: Two scenarios for global AI leadership',
      link: 'https://www.anthropic.com/research/2028-ai-leadership',
      id: 'https://www.anthropic.com/research/2028-ai-leadership',
      publishedAt: '2026-05-14T05:00:00.000Z',
      author: 'Anthropic',
      summary: '',
      category: 'Policy'
    },
    {
      title: "Natural Language Autoencoders: Turning Claude's thoughts into text",
      link: 'https://www.anthropic.com/research/natural-language-autoencoders',
      id: 'https://www.anthropic.com/research/natural-language-autoencoders',
      publishedAt: '2026-05-07T05:00:00.000Z',
      author: 'Anthropic',
      summary: 'AI models like Claude talk in words but think in numbers.',
      category: 'Interpretability'
    }
  ]);
});

test('builds Anthropic News source metadata', () => {
  assert.deepEqual(anthropicNewsSource({ limit: 6 }), {
    id: 'anthropic-news',
    category: 'news',
    title: 'Anthropic News',
    sourceUrl: 'https://www.anthropic.com/news',
    limit: 6
  });
});

test('normalizes Anthropic News cards from HTML', () => {
  const html = `
    <a href="/news/widening-conversation-ai" class="listItem">
      <div class="meta">
        <time class="date">May 19, 2026</time>
        <span class="subject">Announcements</span>
      </div>
      <span class="title">Widening the conversation on frontier AI</span>
    </a>
    <a href="/news/claude-opus-4-7" class="content">
      <h2 class="featuredTitle">Introducing Claude Opus 4.7</h2>
      <div class="meta">
        <span class="caption bold">Product</span>
        <time class="date caption bold">Apr 16, 2026</time>
      </div>
      <p>Our latest Opus model brings stronger performance across coding and agents.</p>
    </a>
    <a href="/news">News</a>
  `;

  assert.deepEqual(normalizeAnthropicNewsItems(html), [
    {
      title: 'Widening the conversation on frontier AI',
      link: 'https://www.anthropic.com/news/widening-conversation-ai',
      id: 'https://www.anthropic.com/news/widening-conversation-ai',
      publishedAt: '2026-05-19T05:00:00.000Z',
      author: 'Anthropic',
      summary: '',
      category: 'Announcements'
    },
    {
      title: 'Introducing Claude Opus 4.7',
      link: 'https://www.anthropic.com/news/claude-opus-4-7',
      id: 'https://www.anthropic.com/news/claude-opus-4-7',
      publishedAt: '2026-04-16T05:00:00.000Z',
      author: 'Anthropic',
      summary: 'Our latest Opus model brings stronger performance across coding and agents.',
      category: 'Product'
    }
  ]);
});

test('builds Vercel announcement feed source metadata', () => {
  assert.deepEqual(vercelAnnouncementSources({
    limit: 8,
    feeds: [
      {
        id: 'vercel-changelog',
        title: 'Vercel Changelog',
        url: 'https://vercel.com/changelog',
        rssUrl: 'https://vercel.com/changelog/rss'
      }
    ]
  }), [
    {
      id: 'vercel-changelog',
      category: 'announcements',
      title: 'Vercel Changelog',
      sourceUrl: 'https://vercel.com/changelog',
      rssUrl: 'https://vercel.com/changelog/rss',
      limit: 8
    }
  ]);
});

test('normalizes Vercel announcement RSS items for static display', () => {
  assert.deepEqual(normalizeVercelAnnouncementItems([
    {
      title: 'Fluid compute updates',
      link: 'https://vercel.com/changelog/fluid-compute-updates',
      guid: 'vercel-changelog-fluid',
      isoDate: '2026-05-19T16:00:00.000Z',
      contentSnippet: 'New deployment infrastructure capabilities.'
    }
  ], { title: 'Vercel Changelog' }), [
    {
      title: 'Fluid compute updates',
      link: 'https://vercel.com/changelog/fluid-compute-updates',
      id: 'vercel-changelog-fluid',
      publishedAt: '2026-05-19T16:00:00.000Z',
      author: 'Vercel',
      summary: 'New deployment infrastructure capabilities.',
      source: 'Vercel Changelog'
    }
  ]);
});

test('builds GitHub organization source metadata', () => {
  assert.deepEqual(githubOrganizationSources([
    {
      id: 'vercel-labs',
      organization: 'vercel-labs',
      url: 'https://github.com/vercel-labs',
      limit: 12
    }
  ]), [
    {
      id: 'github-vercel-labs',
      category: 'github',
      title: 'vercel-labs GitHub',
      organization: 'vercel-labs',
      sourceUrl: 'https://github.com/vercel-labs',
      apiUrl: 'https://api.github.com/orgs/vercel-labs/repos?sort=updated&per_page=12',
      limit: 12
    }
  ]);
});

test('normalizes GitHub organization repositories for static display', () => {
  assert.deepEqual(normalizeGitHubOrganizationRepos([
    {
      id: 123,
      name: 'agent-skills',
      full_name: 'vercel-labs/agent-skills',
      html_url: 'https://github.com/vercel-labs/agent-skills',
      description: "Vercel's official collection of agent skills",
      pushed_at: '2026-05-19T22:19:35Z',
      updated_at: '2026-05-20T16:50:23Z',
      stargazers_count: 26873,
      forks_count: 1200,
      language: 'TypeScript',
      open_issues_count: 42,
      owner: { login: 'vercel-labs' }
    }
  ]), [
    {
      title: 'vercel-labs/agent-skills',
      link: 'https://github.com/vercel-labs/agent-skills',
      id: '123',
      publishedAt: '2026-05-19T22:19:35Z',
      updatedAt: '2026-05-20T16:50:23Z',
      author: 'vercel-labs',
      summary: "Vercel's official collection of agent skills",
      stars: 26873,
      forks: 1200,
      language: 'TypeScript',
      openIssues: 42
    }
  ]);
});

test('builds Meta Research feed source metadata', () => {
  assert.deepEqual(metaResearchFeedSources([
    {
      id: 'meta-research',
      title: 'Meta Research',
      url: 'https://research.facebook.com/',
      rssUrl: 'https://research.facebook.com/feed/',
      limit: 10
    }
  ]), [
    {
      id: 'meta-research',
      category: 'research',
      title: 'Meta Research',
      sourceUrl: 'https://research.facebook.com/',
      rssUrl: 'https://research.facebook.com/feed/',
      limit: 10
    }
  ]);
});

test('normalizes Meta Research RSS feed items', () => {
  assert.deepEqual(normalizeMetaResearchFeedItems([
    {
      title: 'Every tree counts',
      link: 'https://research.facebook.com/blog/2023/4/every-tree-counts-large-scale-mapping-of-canopy-height-at-the-resolution-of-individual-trees/',
      guid: 'meta-tree-counts',
      isoDate: '2023-04-17T01:00:00.000Z',
      contentSnippet: 'Meta is developing technology to mitigate its carbon footprint.',
      categories: ["<![CDATA['Computer Vision']]>", "<![CDATA['Machine Learning']]>"]
    }
  ], { title: 'Meta Research' }), [
    {
      title: 'Every tree counts',
      link: 'https://research.facebook.com/blog/2023/4/every-tree-counts-large-scale-mapping-of-canopy-height-at-the-resolution-of-individual-trees/',
      id: 'meta-tree-counts',
      publishedAt: '2023-04-17T01:00:00.000Z',
      author: 'Meta Research',
      summary: 'Meta is developing technology to mitigate its carbon footprint.',
      categories: ['Computer Vision', 'Machine Learning'],
      source: 'Meta Research'
    }
  ]);
});

test('builds Meta AI Research source metadata', () => {
  assert.deepEqual(metaAiResearchSource({ limit: 1 }), {
    id: 'meta-ai-research',
    category: 'research',
    title: 'Meta AI Research',
    sourceUrl: 'https://ai.meta.com/research/',
    limit: 1
  });
});

test('normalizes Meta AI Research landing page metadata', () => {
  const html = `
    <meta property="og:title" content="AI Research: Introducing Muse Spark - New Foundation Model | AI at Meta" />
    <meta property="og:description" content="Explore Meta's latest AI research and advancements." />
    <script type="application/ld+json">{"@graph":[{"@type":"WebPage","url":"https://ai.meta.com/research/"}]}</script>
  `;

  assert.deepEqual(normalizeMetaAiResearchItems(html, { title: 'Meta AI Research' }), [
    {
      title: 'AI Research: Introducing Muse Spark - New Foundation Model',
      link: 'https://ai.meta.com/research/',
      id: 'https://ai.meta.com/research/',
      publishedAt: null,
      author: 'Meta AI',
      summary: "Explore Meta's latest AI research and advancements.",
      categories: ['AI Research'],
      source: 'Meta AI Research'
    }
  ]);
});

test('builds publication feed source metadata', () => {
  assert.deepEqual(publicationFeedSources([
    {
      id: 'towards-data-science',
      title: 'Towards Data Science',
      url: 'https://towardsdatascience.com/',
      rssUrl: 'https://towardsdatascience.com/feed/',
      limit: 10
    }
  ]), [
    {
      id: 'towards-data-science',
      category: 'publications',
      title: 'Towards Data Science',
      sourceUrl: 'https://towardsdatascience.com/',
      rssUrl: 'https://towardsdatascience.com/feed/',
      limit: 10
    }
  ]);
});

test('normalizes publication feed items', () => {
  assert.deepEqual(normalizePublicationFeedItems([
    {
      title: 'A practical guide to data science',
      link: 'https://towardsdatascience.com/practical-guide/',
      guid: 'tds-practical-guide',
      isoDate: '2026-05-20T12:00:00.000Z',
      creator: 'Towards Data Science',
      contentSnippet: 'A useful summary.',
      categories: ['Machine Learning', 'Data Science']
    }
  ], { title: 'Towards Data Science' }), [
    {
      title: 'A practical guide to data science',
      link: 'https://towardsdatascience.com/practical-guide/',
      id: 'tds-practical-guide',
      publishedAt: '2026-05-20T12:00:00.000Z',
      author: 'Towards Data Science',
      summary: 'A useful summary.',
      categories: ['Machine Learning', 'Data Science'],
      source: 'Towards Data Science'
    }
  ]);
});

test('normalizes publication RSS XML without parsing the entire feed object', () => {
  const xml = `
    <rss><channel>
      <item>
        <title>A practical guide to data science</title>
        <link>https://towardsdatascience.com/practical-guide/</link>
        <guid>tds-practical-guide</guid>
        <pubDate>Wed, 20 May 2026 12:00:00 GMT</pubDate>
        <dc:creator>Towards Data Science</dc:creator>
        <description>A useful summary.</description>
        <category>Machine Learning</category>
        <category>Data Science</category>
      </item>
    </channel></rss>
  `;

  assert.deepEqual(normalizePublicationRssXml(xml, { title: 'Towards Data Science' }), [
    {
      title: 'A practical guide to data science',
      link: 'https://towardsdatascience.com/practical-guide/',
      id: 'tds-practical-guide',
      publishedAt: '2026-05-20T12:00:00.000Z',
      author: 'Towards Data Science',
      summary: 'A useful summary.',
      categories: ['Machine Learning', 'Data Science'],
      source: 'Towards Data Science'
    }
  ]);
});

test('builds xAI research feed source metadata', () => {
  assert.deepEqual(xaiResearchFeedSources({
    limit: 8,
    queries: [
      {
        id: 'xai-official-news',
        title: 'xAI Official News',
        url: 'https://x.ai/news',
        query: 'site:x.ai/news xAI Grok research labs'
      }
    ]
  }), [
    {
      id: 'xai-official-news',
      category: 'research',
      title: 'xAI Official News',
      sourceUrl: 'https://x.ai/news',
      query: 'site:x.ai/news xAI Grok research labs',
      rssUrl: 'https://news.google.com/rss/search?q=site%3Ax.ai%2Fnews+xAI+Grok+research+labs&hl=en-US&gl=US&ceid=US%3Aen',
      limit: 8
    }
  ]);
});

test('normalizes xAI research feed items', () => {
  assert.deepEqual(normalizeXaiResearchFeedItems([
    {
      title: 'Grok Voice Think Fast 1.0 - xAI',
      link: 'https://news.google.com/rss/articles/example',
      guid: 'xai-grok-voice',
      isoDate: '2026-04-30T12:00:00.000Z',
      contentSnippet: 'xAI announced a new flagship voice model.'
    }
  ], { title: 'xAI Official News' }), [
    {
      title: 'Grok Voice Think Fast 1.0 - xAI',
      link: 'https://news.google.com/rss/articles/example',
      id: 'xai-grok-voice',
      publishedAt: '2026-04-30T12:00:00.000Z',
      author: 'xAI',
      summary: 'xAI announced a new flagship voice model.',
      source: 'xAI Official News'
    }
  ]);
});

test('builds Twitter profile source metadata', () => {
  assert.deepEqual(twitterProfileSources({
    limit: 3,
    timeoutMs: 9000,
    provider: 'rsshub',
    rssBaseUrl: 'https://rsshub.example.com',
    handles: ['openai']
  }), [
    {
      id: 'twitter-openai',
      category: 'twitter',
      provider: 'rsshub',
      handle: 'openai',
      normalizedHandle: 'openai',
      title: '@openai',
      sourceUrl: 'https://x.com/openai',
      rssUrl: 'https://rsshub.example.com/twitter/user/openai',
      limit: 3,
      timeoutMs: 9000
    }
  ]);
});

test('normalizes Twitter profile RSS XML', () => {
  const xml = `
    <rss><channel>
      <item>
        <title>OpenAI: New model shipped</title>
        <link>https://nitter.net/openai/status/123</link>
        <guid>https://nitter.net/openai/status/123</guid>
        <pubDate>Wed, 20 May 2026 12:00:00 GMT</pubDate>
        <description><![CDATA[<p>New model shipped</p>]]></description>
      </item>
    </channel></rss>
  `;

  assert.deepEqual(normalizeTwitterProfileRssXml(xml, {
    title: '@openai',
    normalizedHandle: 'openai'
  }), [
    {
      title: 'OpenAI: New model shipped',
      link: 'https://x.com/openai/status/123',
      id: 'https://nitter.net/openai/status/123',
      publishedAt: '2026-05-20T12:00:00.000Z',
      author: '@openai',
      summary: 'New model shipped',
      source: '@openai'
    }
  ]);
});
