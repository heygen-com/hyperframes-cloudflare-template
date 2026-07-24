import { createFileRoute } from "@tanstack/react-router";
import { fetchAsset } from "../../lib/server/assets";

const PREVIEW_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "content-security-policy": "frame-ancestors 'self'; object-src 'none'",
};

export const Route = createFileRoute("/api/preview")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const res = await fetchAsset("_bundled/preview.html", new URL(request.url).origin);
        if (!res.ok) {
          return new Response("preview bundle missing — run build", { status: 500 });
        }
        return new Response(res.body, { headers: PREVIEW_HEADERS });
      },
    },
  },
});
