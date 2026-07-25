// OpenRouter OAuth PKCE flow (https://openrouter.ai/docs/use-cases/oauth-pkce).
// The user is redirected to openrouter.ai/auth; OpenRouter redirects back with
// a one-time code that is exchanged client-side for a runtime API key. No
// client secret is involved, so the whole flow runs in the browser and the
// resulting key never touches our worker outside of generate calls.
//
// The code_verifier must survive the round-trip redirect, so it is parked in
// sessionStorage — the one exception to this app's "nothing in web storage"
// rule. It is safe there: it only exists between leaving for openrouter.ai and
// returning (no generated composition can be running), it is useless without
// the one-time code, and it is deleted before any generation can start.

const AUTH_URL = "https://openrouter.ai/auth";
const KEYS_URL = "https://openrouter.ai/api/v1/auth/keys";
const VERIFIER_STORAGE_KEY = "openrouter-pkce-verifier";

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generateCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** RFC 7636 S256: base64url(sha256(ascii(verifier))). */
export async function computeCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

export function buildAuthUrl(callbackUrl: string, codeChallenge: string): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set("callback_url", callbackUrl);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

/** Store the verifier and send the browser to OpenRouter's consent page. */
export async function startOpenRouterLogin(): Promise<void> {
  const verifier = generateCodeVerifier();
  const challenge = await computeCodeChallenge(verifier);
  sessionStorage.setItem(VERIFIER_STORAGE_KEY, verifier);
  const callbackUrl = window.location.origin + window.location.pathname;
  window.location.assign(buildAuthUrl(callbackUrl, challenge));
}

/**
 * If the current URL carries an OAuth callback code, exchange it for an API
 * key. Returns the key, or null when this page load is not an OAuth callback.
 * Always cleans up: the verifier is removed from sessionStorage and the code
 * is stripped from the URL before this resolves.
 *
 * The exchange is memoized for the lifetime of the page load: the code is
 * one-time and the strip happens before the async exchange resolves, so a
 * repeat call (React StrictMode double-effect, component remount) must get
 * the same promise — not find the code gone and silently drop the key.
 * startOpenRouterLogin navigates away, so a fresh login resets this.
 */
export function consumeOAuthCallback(): Promise<string | null> {
  pendingExchange ??= exchangeCallbackCode();
  return pendingExchange;
}

let pendingExchange: Promise<string | null> | null = null;

async function exchangeCallbackCode(): Promise<string | null> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  if (!code) return null;

  const verifier = sessionStorage.getItem(VERIFIER_STORAGE_KEY);
  sessionStorage.removeItem(VERIFIER_STORAGE_KEY);
  url.searchParams.delete("code");
  window.history.replaceState(null, "", url.toString());

  if (!verifier) {
    throw new Error("Login session expired — please log in with OpenRouter again.");
  }

  const res = await fetch(KEYS_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
  });
  if (!res.ok) {
    throw new Error(
      `OpenRouter key exchange failed (${res.status}) — please try logging in again.`,
    );
  }
  const body = (await res.json()) as { key?: unknown };
  if (typeof body.key !== "string" || !body.key) {
    throw new Error("OpenRouter key exchange returned no key — please try logging in again.");
  }
  return body.key;
}
