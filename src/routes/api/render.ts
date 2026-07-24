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

        let files: Array<{ path: string; content: string }>;
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
        await env.RENDERS.put(key, containerRes.body, {
          httpMetadata: { contentType: "video/mp4" },
        });

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
