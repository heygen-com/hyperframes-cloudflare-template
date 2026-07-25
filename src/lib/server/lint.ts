import { lintHyperframeHtml } from "@hyperframes/core/lint";
import type { LintError } from "../generation";

// The `invalid_inline_script_syntax` rule probes JS via `new Function(source)`,
// which V8 isolates disallow ("Code generation from strings disallowed"). The
// rule throws on every inline script in Workers, so filter that one variant —
// Chrome inside the render container catches real syntax errors at render time.
// The malformed-close-tag variant of the same code (regex-based) still runs.
export function lintFiltered(html: string): LintError[] {
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
