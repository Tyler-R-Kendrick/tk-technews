import fs from 'node:fs/promises';
import path from 'node:path';
import monitoredSources from '../data/monitored-sources.json' with { type: 'json' };
import { precompileSources } from './lib/precompile-sources.mjs';

const outputDir = path.join(process.cwd(), 'src', 'data', 'precompiled');
const result = await precompileSources(monitoredSources);

await fs.mkdir(outputDir, { recursive: true });
await Promise.all([
  fs.writeFile(path.join(outputDir, 'source-index.json'), `${JSON.stringify({
    generatedAt: result.generatedAt,
    summary: result.summary
  }, null, 2)}\n`),
  fs.writeFile(path.join(outputDir, 'youtube-latest.json'), `${JSON.stringify({
    generatedAt: result.generatedAt,
    sources: result.youtube
  }, null, 2)}\n`),
  fs.writeFile(path.join(outputDir, 'google-news-latest.json'), `${JSON.stringify({
    generatedAt: result.generatedAt,
    sources: result.googleNews
  }, null, 2)}\n`),
  fs.writeFile(path.join(outputDir, 'huggingface-daily-papers.json'), `${JSON.stringify({
    generatedAt: result.generatedAt,
    source: result.huggingFacePapers
  }, null, 2)}\n`),
  fs.writeFile(path.join(outputDir, 'google-research-blog.json'), `${JSON.stringify({
    generatedAt: result.generatedAt,
    source: result.googleResearch
  }, null, 2)}\n`),
  fs.writeFile(path.join(outputDir, 'anthropic-research.json'), `${JSON.stringify({
    generatedAt: result.generatedAt,
    source: result.anthropic
  }, null, 2)}\n`),
  fs.writeFile(path.join(outputDir, 'anthropic-news.json'), `${JSON.stringify({
    generatedAt: result.generatedAt,
    source: result.anthropicNews
  }, null, 2)}\n`),
  fs.writeFile(path.join(outputDir, 'vercel-announcements.json'), `${JSON.stringify({
    generatedAt: result.generatedAt,
    sources: result.vercel
  }, null, 2)}\n`),
  fs.writeFile(path.join(outputDir, 'github-organizations.json'), `${JSON.stringify({
    generatedAt: result.generatedAt,
    sources: result.github
  }, null, 2)}\n`),
  fs.writeFile(path.join(outputDir, 'meta-research.json'), `${JSON.stringify({
    generatedAt: result.generatedAt,
    sources: result.metaResearch,
    aiResearch: result.metaAi
  }, null, 2)}\n`),
  fs.writeFile(path.join(outputDir, 'publication-feeds.json'), `${JSON.stringify({
    generatedAt: result.generatedAt,
    sources: result.publications
  }, null, 2)}\n`),
  fs.writeFile(path.join(outputDir, 'xai-research.json'), `${JSON.stringify({
    generatedAt: result.generatedAt,
    sources: result.xaiResearch
  }, null, 2)}\n`),
  fs.writeFile(path.join(outputDir, 'twitter-feeds.json'), `${JSON.stringify({
    generatedAt: result.generatedAt,
    sources: result.twitter
  }, null, 2)}\n`)
]);

const youtubeErrors = result.youtube.filter((source) => source.status !== 'ok').length;
const googleErrors = result.googleNews.filter((source) => source.status !== 'ok').length;
const huggingFaceErrors = result.huggingFacePapers?.status === 'ok' ? 0 : 1;
const googleResearchErrors = result.googleResearch?.status === 'ok' ? 0 : 1;
const anthropicResearchErrors = result.anthropic?.status === 'ok' ? 0 : 1;
const anthropicNewsErrors = result.anthropicNews?.status === 'ok' ? 0 : 1;
const vercelErrors = result.vercel.filter((source) => source.status !== 'ok').length;
const githubErrors = result.github.filter((source) => source.status !== 'ok').length;
const metaResearchErrors = result.metaResearch.filter((source) => source.status !== 'ok').length;
const metaAiErrors = result.metaAi?.status === 'ok' ? 0 : 1;
const publicationFeedErrors = result.publications.filter((source) => source.status !== 'ok').length;
const xaiResearchErrors = result.xaiResearch.filter((source) => source.status !== 'ok').length;
const twitterErrors = result.twitter.filter((source) => source.status !== 'ok').length;

console.log(`Precompiled ${result.youtube.length} YouTube channels, ${result.googleNews.length} Google News topics, Hugging Face Daily Papers, Google Research Blog, Anthropic Research, Anthropic News, Vercel announcements, GitHub orgs, Meta research, publication feeds, xAI research feeds, and X/Twitter profiles.`);
console.log(`YouTube ok/error: ${result.summary.youtubeOk}/${youtubeErrors}`);
console.log(`Google News ok/error: ${result.summary.googleNewsOk}/${googleErrors}`);
console.log(`Hugging Face papers ok/error: ${result.summary.huggingFacePapersOk}/${huggingFaceErrors}`);
console.log(`Google Research blog ok/error: ${result.summary.googleResearchOk}/${googleResearchErrors}`);
console.log(`Anthropic Research ok/error: ${result.summary.anthropicResearchOk}/${anthropicResearchErrors}`);
console.log(`Anthropic News ok/error: ${result.summary.anthropicNewsOk}/${anthropicNewsErrors}`);
console.log(`Vercel announcements ok/error: ${result.summary.vercelAnnouncementsOk}/${vercelErrors}`);
console.log(`GitHub organizations ok/error: ${result.summary.githubOrganizationsOk}/${githubErrors}`);
console.log(`Meta Research feeds ok/error: ${result.summary.metaResearchOk}/${metaResearchErrors}`);
console.log(`Meta AI Research ok/error: ${result.summary.metaAiResearchOk}/${metaAiErrors}`);
console.log(`Publication feeds ok/error: ${result.summary.publicationFeedsOk}/${publicationFeedErrors}`);
console.log(`xAI Research feeds ok/error: ${result.summary.xaiResearchFeedsOk}/${xaiResearchErrors}`);
console.log(`X/Twitter profiles ok/error: ${result.summary.twitterProfilesOk}/${twitterErrors}`);
