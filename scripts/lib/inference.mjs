import { z } from 'zod';

export class InferenceUnavailableError extends Error {
  constructor(message = 'No inference provider is available.') {
    super(message);
    this.name = 'InferenceUnavailableError';
    this.code = 'inference_unavailable';
  }
}

export class StructuredOutputError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'StructuredOutputError';
    this.code = 'structured_output_invalid';
    this.details = details;
  }
}

export async function generateStructuredObject({
  task,
  schema,
  prompt,
  context = {},
  providers = defaultProviders(),
  providerPreference = process.env.TK_TECHNEWS_INFERENCE_PROVIDER ?? 'auto',
  maxAttemptsPerProvider = 2
}) {
  const orderedProviders = filterProviders(providers, providerPreference);
  const failures = [];

  for (const provider of orderedProviders) {
    if (!await provider.available()) continue;

    let validationNote = '';
    for (let attempt = 1; attempt <= maxAttemptsPerProvider; attempt += 1) {
      try {
        const raw = await provider.generate({
          task,
          prompt: validationNote ? `${prompt}\n\nPrevious output failed validation:\n${validationNote}\nReturn valid JSON only.` : prompt,
          context,
          schema
        });
        const parsed = parseStructuredResult(raw);
        const validation = schema.safeParse(parsed);
        if (!validation.success) {
          validationNote = z.prettifyError(validation.error);
          failures.push({ provider: provider.name, attempt, error: validationNote });
          continue;
        }

        return {
          output: validation.data,
          provider: provider.name,
          model: provider.model ?? null,
          raw
        };
      } catch (error) {
        failures.push({ provider: provider.name, attempt, error: error.message });
        break;
      }
    }
  }

  if (failures.length === 0) {
    throw new InferenceUnavailableError();
  }
  throw new StructuredOutputError('No inference provider produced schema-valid JSON.', { failures });
}

export function defaultProviders() {
  return [
    aiSdkProvider(),
    codexProvider(),
    githubCopilotProvider()
  ];
}

export function parseStructuredResult(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    if ('output' in raw) return raw.output;
    if ('object' in raw) return raw.object;
  }
  if (typeof raw !== 'string') return raw;

  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced) return JSON.parse(fenced[1]);
    const objectMatch = trimmed.match(/\{[\s\S]*\}/);
    if (objectMatch) return JSON.parse(objectMatch[0]);
    throw new StructuredOutputError('Provider returned text that was not valid JSON.', { raw });
  }
}

function aiSdkProvider() {
  const model = process.env.TK_TECHNEWS_MODEL ?? 'gpt-5.4-mini';
  return {
    name: 'ai-sdk',
    model,
    available: async () => Boolean(process.env.OPENAI_API_KEY || process.env.AI_GATEWAY_API_KEY),
    generate: async ({ prompt, schema }) => {
      const { generateText, Output } = await import('ai');
      const modelSpec = await aiSdkModel(model);
      const result = await generateText({
        model: modelSpec,
        output: Output.object({ schema }),
        prompt
      });
      return result.output;
    }
  };
}

async function aiSdkModel(model) {
  if (process.env.AI_GATEWAY_API_KEY && !process.env.OPENAI_API_KEY) {
    return model;
  }
  const { openai } = await import('@ai-sdk/openai');
  return openai(model);
}

function codexProvider() {
  const model = process.env.TK_TECHNEWS_CODEX_MODEL ?? process.env.TK_TECHNEWS_MODEL ?? 'gpt-5.4';
  return {
    name: 'codex',
    model,
    available: async () => {
      try {
        await import('@openai/codex-sdk');
        return true;
      } catch {
        return false;
      }
    },
    generate: async ({ task, prompt }) => {
      const { Codex } = await import('@openai/codex-sdk');
      const codex = new Codex();
      const thread = codex.startThread({
        workingDirectory: process.cwd(),
        skipGitRepoCheck: true,
        model
      });
      const turn = await thread.run([
        {
          type: 'text',
          text: [
            `Task: ${task}`,
            'Return strict JSON only. Do not edit files. Do not run commands.',
            prompt
          ].join('\n\n')
        }
      ]);
      return extractCodexText(turn);
    }
  };
}

function githubCopilotProvider() {
  const model = process.env.TK_TECHNEWS_COPILOT_MODEL ?? process.env.TK_TECHNEWS_MODEL ?? 'gpt-5';
  return {
    name: 'github-copilot',
    id: 'copilot',
    model,
    available: async () => {
      try {
        await import('@github/copilot-sdk');
        return true;
      } catch {
        return false;
      }
    },
    generate: async ({ task, prompt }) => {
      const { CopilotClient } = await import('@github/copilot-sdk');
      const client = new CopilotClient({
        gitHubToken: process.env.GITHUB_TOKEN || process.env.GH_TOKEN || undefined,
        useLoggedInUser: !process.env.GITHUB_TOKEN && !process.env.GH_TOKEN
      });
      let session;
      try {
        await client.start();
        session = await client.createSession({
          model,
          infiniteSessions: { enabled: false },
          onPermissionRequest: denyCopilotToolUse,
          systemMessage: {
            mode: 'customize',
            content: [
              'You are a structured inference fallback for TK TechNews.',
              'Return strict JSON only.',
              'Do not edit files, run commands, fetch URLs, use tools, or ask the user questions.'
            ].join('\n')
          }
        });
        const message = [
          `Task: ${task}`,
          'Return strict JSON only. Do not include Markdown fences or commentary.',
          prompt
        ].join('\n\n');
        const event = await session.sendAndWait({ prompt: message }, 120000);
        return extractCopilotText(event ?? await session.getMessages());
      } finally {
        if (session) await session.disconnect().catch(() => {});
        await client.stop().catch(() => {});
      }
    }
  };
}

function denyCopilotToolUse() {
  return { kind: 'denied-by-rules' };
}

function extractCodexText(turn) {
  if (typeof turn === 'string') return turn;
  if (turn?.text) return turn.text;
  if (turn?.finalResponse) return turn.finalResponse;
  if (turn?.outputText) return turn.outputText;
  const items = turn?.items ?? turn?.events ?? [];
  const text = items
    .map((item) => item.text ?? item.content ?? item.message ?? '')
    .filter(Boolean)
    .join('\n');
  if (text) return text;
  return JSON.stringify(turn);
}

function extractCopilotText(event) {
  if (typeof event === 'string') return event;
  if (event?.data?.content) return event.data.content;
  if (event?.content) return event.content;
  if (event?.message?.content) return event.message.content;
  const items = Array.isArray(event) ? event : event?.items ?? event?.events ?? [];
  const text = items
    .map((item) => item?.data?.content ?? item?.content ?? item?.message?.content ?? item?.text ?? '')
    .filter(Boolean)
    .join('\n');
  if (text) return text;
  return JSON.stringify(event);
}

function filterProviders(providers, preference) {
  if (preference === 'auto') return providers;
  return providers.filter((provider) => provider.name === preference || provider.id === preference);
}
