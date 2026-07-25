import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { getContainer } from "@cloudflare/containers";
import {
  htmlToFiles,
  isJsonRequest,
  jsonError,
  loadBundledCompositionFiles,
  msg,
  utf8ByteLength,
  type CompositionFile,
} from "../../lib/server/assets";

const MAX_RENDER_HTML_BYTES = 2 * 1024 * 1024;

interface RenderRequestBody {
  html?: string;
}

export const Route = createFileRoute("/api/render")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const t0 = Date.now();

        let files: CompositionFile[];
        let source: "bundled" | "html" = "bundled";

        // Empty body falls through to the bundled composition for back-compat
        // with the original "click Render" flow that doesn't post any body.
        let body: RenderRequestBody | null = null;
        if (isJsonRequest(request)) {
          try {
            body = (await request.json()) as RenderRequestBody;
          } catch {
            return jsonError("invalid JSON body", 400);
          }
        }

        if (body?.html) {
          // Same gate as /api/generate: without it, ENABLE_AI_GEN="false"
          // deployments would still let anyone run the render container on
          // arbitrary HTML. The bundled-composition path below stays open.
          if (env.ENABLE_AI_GEN !== "true") {
            return jsonError(
              'Rendering custom HTML is disabled on this deployment. Set ENABLE_AI_GEN="true" in wrangler.jsonc vars to enable it.',
              403,
            );
          }
          if (typeof body.html !== "string") {
            return jsonError("html must be a string", 400);
          }
          if (utf8ByteLength(body.html) > MAX_RENDER_HTML_BYTES) {
            return jsonError(`html exceeds ${MAX_RENDER_HTML_BYTES} bytes`, 413);
          }
          files = htmlToFiles(body.html);
          source = "html";
        } else {
          try {
            files = await loadBundledCompositionFiles(new URL(request.url).origin);
          } catch (err) {
            return jsonError(`failed to load composition: ${msg(err)}`, 500);
          }
        }

        const container = getContainer(env.RENDER_CONTAINER, "renderer");
        let containerRes: Response;
        try {
          containerRes = await container.fetch(
            new Request("http://container/render", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ files }),
            }),
          );
        } catch (err) {
          return jsonError(`container unavailable: ${msg(err)}`, 502);
        }

        if (!containerRes.ok) {
          const errBody = await containerRes.text().catch(() => "");
          return jsonError(`render failed (${containerRes.status}): ${errBody}`, 502);
        }

        const key = `renders/${Date.now()}-${crypto.randomUUID()}.mp4`;
        try {
          await env.RENDERS.put(key, containerRes.body, {
            httpMetadata: { contentType: "video/mp4" },
          });
        } catch (err) {
          console.error(`R2 put failed for ${key} (source: ${source}, ${Date.now() - t0}ms):`, err);
          return jsonError(`failed to store rendered video: ${msg(err)}`, 500);
        }

        const url = new URL(request.url);
        url.pathname = `/r/${key}`;

        return Response.json({
          url: url.toString(),
          key,
          source,
          durationMs: Date.now() - t0,
        });
      },
    },
  },
});
