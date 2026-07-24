// Shared between client and server — keep free of server-only imports.

export const DEFAULT_MODEL = "google/gemini-3-flash-preview";

/** 1 initial generation + up to 2 lint-driven self-heal turns. */
export const MAX_GENERATE_ATTEMPTS = 3;

export interface LintError {
  code: string;
  message: string;
}

export function stripMarkdownFence(text: string): string {
  let s = text.trim();
  if (s.startsWith("```html")) s = s.slice(7);
  else if (s.startsWith("```")) s = s.slice(3);
  if (s.endsWith("```")) s = s.slice(0, -3);
  return s.trim();
}

/** The follow-up user turn that asks the model to fix lint failures. */
export function buildFixMessage(lintErrors: LintError[]): string {
  const errorList = lintErrors
    .map((e, idx) => `${idx + 1}. [${e.code}] ${e.message}`)
    .join("\n");

  return `The composition above failed validation. Fix these errors and return the corrected HTML.

Errors:
${errorList}

Return ONLY the fixed HTML — no explanations, no markdown fences. Start with <!DOCTYPE html>.`;
}
