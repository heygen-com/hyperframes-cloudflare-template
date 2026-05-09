/**
 * AI generation pipeline — prompt to HyperFrames composition HTML.
 *
 * Calls OpenRouter directly via fetch (no SDK). The user supplies their own
 * OpenRouter API key in the request body — we forward it once to OpenRouter
 * and discard it. The key is never logged, persisted, or cached.
 *
 * Self-healing: lint with @hyperframes/core/lint, retry up to N times with
 * the lint feedback in a follow-up prompt.
 */

import { lintHyperframeHtml } from "@hyperframes/core/lint";
import { buildSystemPrompt, buildUserPrompt } from "./hyperframes-skill.js";

export interface GenerateOptions {
  apiKey: string;
  prompt: string;
  /** Override the default model. */
  model?: string;
  /** Lint self-heal max retries. Default 2. */
  maxRetries?: number;
  /** Override duration target in seconds. Default 6. */
  durationSec?: number;
  /** Optional referer header for OpenRouter analytics. */
  referer?: string;
  /** Optional app title for OpenRouter analytics. */
  appTitle?: string;
}

export interface GenerateResult {
  html: string;
  model: string;
  attempts: number;
  durationMs: number;
  lintErrors: Array<{ code: string; message: string }>;
}

const DEFAULT_MODEL = "google/gemini-3-flash-preview";
const DEFAULT_MAX_RETRIES = 2;
const MAX_OUTPUT_TOKENS = 16000;

interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenRouterChoice {
  message?: { content?: string };
  finish_reason?: string;
}

interface OpenRouterResponse {
  choices?: OpenRouterChoice[];
  error?: { message?: string; code?: number };
}

export class GenerateError extends Error {
  constructor(message: string, public status: number = 500) {
    super(message);
    this.name = "GenerateError";
  }
}

function stripMarkdownFence(text: string): string {
  let s = text.trim();
  if (s.startsWith("```html")) s = s.slice(7);
  else if (s.startsWith("```")) s = s.slice(3);
  if (s.endsWith("```")) s = s.slice(0, -3);
  return s.trim();
}

async function callOpenRouter(
  apiKey: string,
  model: string,
  messages: OpenRouterMessage[],
  opts: { temperature: number; referer?: string; appTitle?: string },
): Promise<string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
  };
  if (opts.referer) headers["http-referer"] = opts.referer;
  if (opts.appTitle) headers["x-title"] = opts.appTitle;

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages,
      max_tokens: MAX_OUTPUT_TOKENS,
      temperature: opts.temperature,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // OpenRouter returns 401 for bad keys, 429 for rate limit. Surface those
    // codes back to the client so the UI can show "check your key" vs "rate limited".
    let detail = body;
    try {
      const parsed = JSON.parse(body) as OpenRouterResponse;
      detail = parsed.error?.message ?? body;
    } catch {
      /* keep raw body */
    }
    throw new GenerateError(
      `openrouter ${res.status}: ${detail || res.statusText}`,
      res.status === 401 || res.status === 429 ? res.status : 502,
    );
  }

  const json = (await res.json()) as OpenRouterResponse;
  if (json.error?.message) {
    throw new GenerateError(`openrouter error: ${json.error.message}`, 502);
  }
  const text = json.choices?.[0]?.message?.content;
  if (!text || typeof text !== "string") {
    throw new GenerateError("openrouter returned no content", 502);
  }
  return text;
}

export async function generateComposition(opts: GenerateOptions): Promise<GenerateResult> {
  if (!opts.apiKey || typeof opts.apiKey !== "string") {
    throw new GenerateError("missing apiKey", 400);
  }
  if (!opts.prompt || typeof opts.prompt !== "string") {
    throw new GenerateError("missing prompt", 400);
  }

  const t0 = Date.now();
  const model = opts.model ?? DEFAULT_MODEL;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const referer = opts.referer;
  const appTitle = opts.appTitle ?? "HyperFrames Cloudflare Template";

  const systemPrompt = buildSystemPrompt(true);
  const userPrompt = buildUserPrompt(opts.prompt, opts.durationSec);

  let html = "";
  let attempts = 0;
  let lintErrors: Array<{ code: string; message: string }> = [];

  // Initial generation
  const initialText = await callOpenRouter(opts.apiKey, model, [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ], { temperature: 0.7, referer, appTitle });
  attempts++;
  html = stripMarkdownFence(initialText);

  // Lint + self-heal loop
  for (let i = 0; i <= maxRetries; i++) {
    const result = lintHyperframeHtml(html, { filePath: "composition.html" });
    lintErrors = result.findings
      .filter((f) => f.severity === "error")
      .map((f) => ({ code: f.code, message: f.message }));

    if (lintErrors.length === 0) {
      return { html, model, attempts, durationMs: Date.now() - t0, lintErrors: [] };
    }

    if (i === maxRetries) break;

    // Ask the model to fix its own output, with lint feedback inline.
    const errorList = lintErrors
      .map((e, idx) => `${idx + 1}. [${e.code}] ${e.message}`)
      .join("\n");

    const fixText = await callOpenRouter(opts.apiKey, model, [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
      { role: "assistant", content: html },
      {
        role: "user",
        content: `The composition above failed validation. Fix these errors and return the corrected HTML.

Errors:
${errorList}

Return ONLY the fixed HTML — no explanations, no markdown fences. Start with <!DOCTYPE html>.`,
      },
    ], { temperature: 0.3, referer, appTitle });
    attempts++;
    html = stripMarkdownFence(fixText);
  }

  // Exhausted retries — return the last attempt with lint errors so the
  // caller can decide whether to render anyway or surface to the user.
  return { html, model, attempts, durationMs: Date.now() - t0, lintErrors };
}
