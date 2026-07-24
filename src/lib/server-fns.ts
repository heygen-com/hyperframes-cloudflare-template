import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import type { LintError } from "./generation";
import { lintFiltered } from "./server/lint";

export const getAppConfig = createServerFn({ method: "GET" }).handler(async () => {
  return { aiGenEnabled: env.ENABLE_AI_GEN === "true" };
});

export const lintComposition = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as { html?: unknown } | null | undefined;
    if (!d || typeof d.html !== "string") throw new Error("html must be a string");
    return { html: d.html };
  })
  .handler(async ({ data }): Promise<{ errors: LintError[] }> => {
    return { errors: lintFiltered(data.html) };
  });
