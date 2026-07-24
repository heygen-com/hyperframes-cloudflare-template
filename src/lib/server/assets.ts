import { env } from "cloudflare:workers";
import manifest from "../../composition-manifest.json";

const ENCODER = new TextEncoder();

export function utf8ByteLength(s: string): number {
  return ENCODER.encode(s).byteLength;
}

// The origin must be the incoming request's own origin: the Vite plugin's dev
// emulation of the assets binding rejects cross-origin URLs (403), while the
// deployed binding ignores the host entirely.
export function fetchAsset(path: string, origin: string): Promise<Response> {
  return env.ASSETS.fetch(new Request(`${origin}/${path}`));
}

export function bufferToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export async function loadBundledCompositionFiles(origin: string): Promise<Array<{ path: string; content: string }>> {
  return Promise.all(
    manifest.files.map(async (rel) => {
      const res = await fetchAsset(`${manifest.dir}/${rel}`, origin);
      if (!res.ok) throw new Error(`asset missing: ${rel} (${res.status})`);
      const buf = new Uint8Array(await res.arrayBuffer());
      return { path: rel, content: bufferToBase64(buf) };
    }),
  );
}

export function htmlToFiles(html: string): Array<{ path: string; content: string }> {
  return [{ path: "index.html", content: bufferToBase64(ENCODER.encode(html)) }];
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
