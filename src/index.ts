import { getContainer } from "@cloudflare/containers";
import { RenderContainer } from "./container.js";
import manifest from "./composition-manifest.json";
import { generateComposition, GenerateError } from "./lib/generate.js";

export { RenderContainer };

interface Env {
  ASSETS: Fetcher;
  RENDER_CONTAINER: DurableObjectNamespace<RenderContainer>;
  RENDERS: R2Bucket;
  /** "true" enables BYOK AI generation. Off by default. Configure in wrangler.jsonc vars. */
  ENABLE_AI_GEN?: string;
}

const PREVIEW_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "content-security-policy": "frame-ancestors 'self'; object-src 'none'",
};

const MAX_GENERATE_PROMPT_BYTES = 8 * 1024;
const MAX_GENERATE_KEY_BYTES = 1024;
const MAX_RENDER_HTML_BYTES = 2 * 1024 * 1024;

const ENCODER = new TextEncoder();

function isJsonRequest(req: Request): boolean {
  return req.headers.get("content-type")?.includes("application/json") ?? false;
}

function utf8ByteLength(s: string): number {
  return ENCODER.encode(s).byteLength;
}

function fetchAsset(env: Env, path: string): Promise<Response> {
  return env.ASSETS.fetch(new Request(`http://assets/${path}`));
}

async function handlePreview(env: Env): Promise<Response> {
  const res = await fetchAsset(env, "_bundled/preview.html");
  if (!res.ok) return new Response("preview bundle missing — run build", { status: 500 });
  return new Response(res.body, { headers: PREVIEW_HEADERS });
}

async function loadBundledCompositionFiles(env: Env): Promise<Array<{ path: string; content: string }>> {
  return Promise.all(
    manifest.files.map(async (rel) => {
      const res = await fetchAsset(env, `${manifest.dir}/${rel}`);
      if (!res.ok) throw new Error(`asset missing: ${rel} (${res.status})`);
      const buf = new Uint8Array(await res.arrayBuffer());
      return { path: rel, content: bufferToBase64(buf) };
    }),
  );
}

function bufferToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function htmlToFiles(html: string): Array<{ path: string; content: string }> {
  return [
    {
      path: "index.html",
      content: bufferToBase64(ENCODER.encode(html)),
    },
  ];
}

interface RenderRequestBody {
  html?: string;
}

async function handleRender(env: Env, req: Request): Promise<Response> {
  const t0 = Date.now();

  let files: Array<{ path: string; content: string }>;
  let source: "bundled" | "html" = "bundled";

  // Empty body falls through to the bundled composition for back-compat with
  // the original "click Render" flow that doesn't post any body.
  let body: RenderRequestBody | null = null;
  if (isJsonRequest(req)) {
    try {
      body = (await req.json()) as RenderRequestBody;
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
      files = await loadBundledCompositionFiles(env);
    } catch (err) {
      return jsonError(`failed to load composition: ${msg(err)}`, 500);
    }
  }

  const container = getContainer(env.RENDER_CONTAINER, "renderer");
  let containerRes;
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

  const url = new URL(req.url);
  url.pathname = `/r/${key}`;

  return Response.json({
    url: url.toString(),
    key,
    source,
    durationMs: Date.now() - t0,
  });
}

interface GenerateRequestBody {
  apiKey?: string;
  prompt?: string;
  model?: string;
  durationSec?: number;
}

async function handleGenerate(env: Env, req: Request): Promise<Response> {
  if (env.ENABLE_AI_GEN !== "true") {
    return jsonError(
      "AI generation is disabled on this deployment. Set ENABLE_AI_GEN=\"true\" in wrangler.jsonc vars to enable BYOK generation.",
      403,
    );
  }

  if (!isJsonRequest(req)) {
    return jsonError("expected application/json", 415);
  }

  let body: GenerateRequestBody;
  try {
    body = (await req.json()) as GenerateRequestBody;
  } catch {
    return jsonError("invalid JSON body", 400);
  }

  if (!body.apiKey || typeof body.apiKey !== "string") {
    return jsonError("missing apiKey (your OpenRouter key)", 400);
  }
  if (body.apiKey.length > MAX_GENERATE_KEY_BYTES) {
    return jsonError("apiKey too long", 400);
  }
  if (!body.prompt || typeof body.prompt !== "string") {
    return jsonError("missing prompt", 400);
  }
  if (utf8ByteLength(body.prompt) > MAX_GENERATE_PROMPT_BYTES) {
    return jsonError(`prompt exceeds ${MAX_GENERATE_PROMPT_BYTES} bytes`, 413);
  }

  const referer = req.headers.get("origin") ?? new URL(req.url).origin;

  try {
    const result = await generateComposition({
      apiKey: body.apiKey,
      prompt: body.prompt,
      model: body.model,
      durationSec: typeof body.durationSec === "number" ? body.durationSec : undefined,
      referer,
    });

    return Response.json({
      html: result.html,
      model: result.model,
      attempts: result.attempts,
      durationMs: result.durationMs,
      lintErrors: result.lintErrors,
      lintOk: result.lintErrors.length === 0,
    });
  } catch (err) {
    if (err instanceof GenerateError) {
      return jsonError(err.message, err.status);
    }
    return jsonError(`generation failed: ${msg(err)}`, 500);
  }
}

async function handleR2Get(env: Env, key: string): Promise<Response> {
  const obj = await env.RENDERS.get(key);
  if (!obj) return new Response("not found", { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  return new Response(obj.body, { headers });
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const { pathname } = url;

    if (req.method === "POST" && pathname === "/api/render") {
      return handleRender(env, req);
    }

    if (req.method === "POST" && pathname === "/api/generate") {
      return handleGenerate(env, req);
    }

    if (req.method === "GET" && pathname === "/api/preview") {
      return handlePreview(env);
    }

    if (req.method === "GET" && pathname === "/api/config") {
      return Response.json(
        { aiGenEnabled: env.ENABLE_AI_GEN === "true" },
        { headers: { "cache-control": "public, max-age=300" } },
      );
    }

    if (req.method === "GET" && pathname.startsWith("/r/")) {
      const key = pathname.slice("/r/".length);
      return handleR2Get(env, key);
    }

    return env.ASSETS.fetch(req);
  },
};
