import { env } from "cloudflare:workers";
import manifest from "../../composition-manifest.json";
import { bufferToBase64, utf8Encode } from "../encoding";

export { bufferToBase64, utf8ByteLength } from "../encoding";

/** One file of a composition as the render container expects it. */
export interface CompositionFile {
  path: string;
  /** base64-encoded file bytes */
  content: string;
}

// The origin must be the incoming request's own origin: the Vite plugin's dev
// emulation of the assets binding rejects cross-origin URLs (403), while the
// deployed binding ignores the host entirely.
export function fetchAsset(path: string, origin: string): Promise<Response> {
  return env.ASSETS.fetch(new Request(`${origin}/${path}`));
}

export async function loadBundledCompositionFiles(origin: string): Promise<CompositionFile[]> {
  return Promise.all(
    manifest.files.map(async (rel) => {
      const res = await fetchAsset(`${manifest.dir}/${rel}`, origin);
      if (!res.ok) throw new Error(`asset missing: ${rel} (${res.status})`);
      const buf = new Uint8Array(await res.arrayBuffer());
      return { path: rel, content: bufferToBase64(buf) };
    }),
  );
}

export function htmlToFiles(html: string): CompositionFile[] {
  return [{ path: "index.html", content: bufferToBase64(utf8Encode(html)) }];
}

export function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function isJsonRequest(req: Request): boolean {
  return req.headers.get("content-type")?.includes("application/json") ?? false;
}
