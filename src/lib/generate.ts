import { lintHyperframeHtml } from "@hyperframes/core/lint";
import { SYSTEM_PROMPT_WITH_EXAMPLE, buildUserPrompt } from "./hyperframes-skill.js";

export interface GenerateOptions {
  apiKey: string;
  prompt: string;
  model?: string;
  maxRetries?: number;
  durationSec?: number;
  referer?: string;
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

// The `invalid_inline_script_syntax` rule probes JS via `new Function(source)`,
// which V8 isolates disallow ("Code generation from strings disallowed"). The
// rule throws on every inline script in Workers, so filter that one variant —
// Chrome inside the render container catches real syntax errors at render time.
// The malformed-close-tag variant of the same code (regex-based) still runs.
function lintFiltered(html: string): Array<{ code: string; message: string }> {
  const result = lintHyperframeHtml(html, { filePath: "composition.html" });
  return result.findings
    .filter(
      (f) =>
        f.severity === "error" &&
        !(
          f.code === "invalid_inline_script_syntax" &&
          /Code generation from strings|disallowed/i.test(f.message)
        ),
    )
    .map((f) => ({ code: f.code, message: f.message }));
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
  const userPrompt = buildUserPrompt(opts.prompt, opts.durationSec);
  const callOpts = { referer, appTitle };

  let attempts = 1;
  let html = stripMarkdownFence(
    await callOpenRouter(opts.apiKey, model, [
      { role: "system", content: SYSTEM_PROMPT_WITH_EXAMPLE },
      { role: "user", content: userPrompt },
    ], { temperature: 0.7, ...callOpts }),
  );
  let lintErrors = lintFiltered(html);

  for (let retry = 0; retry < maxRetries && lintErrors.length > 0; retry++) {
    const errorList = lintErrors
      .map((e, idx) => `${idx + 1}. [${e.code}] ${e.message}`)
      .join("\n");

    const fixText = await callOpenRouter(opts.apiKey, model, [
      { role: "system", content: SYSTEM_PROMPT_WITH_EXAMPLE },
      { role: "user", content: userPrompt },
      { role: "assistant", content: html },
      {
        role: "user",
        content: `The composition above failed validation. Fix these errors and return the corrected HTML.

Errors:
${errorList}

Return ONLY the fixed HTML — no explanations, no markdown fences. Start with <!DOCTYPE html>.`,
      },
    ], { temperature: 0.3, ...callOpts });
    attempts++;
    html = stripMarkdownFence(fixText);
    lintErrors = lintFiltered(html);
  }

  return { html, model, attempts, durationMs: Date.now() - t0, lintErrors };
}
