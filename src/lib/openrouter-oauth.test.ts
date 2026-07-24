import { describe, expect, it } from "vitest";
import {
  base64UrlEncode,
  buildAuthUrl,
  computeCodeChallenge,
  generateCodeVerifier,
} from "./openrouter-oauth";

describe("base64UrlEncode", () => {
  it("encodes without padding or +/ characters", () => {
    // 0xfb 0xef 0xff base64-encodes to "++//" — must become "--__"
    expect(base64UrlEncode(new Uint8Array([0xfb, 0xef, 0xff]))).toBe("--__");
    expect(base64UrlEncode(new Uint8Array([0x66]))).toBe("Zg");
  });

  it("handles empty input", () => {
    expect(base64UrlEncode(new Uint8Array(0))).toBe("");
  });
});

describe("generateCodeVerifier", () => {
  it("produces a base64url string of 43 chars (32 random bytes)", () => {
    const v = generateCodeVerifier();
    expect(v).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("produces distinct values", () => {
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier());
  });
});

describe("computeCodeChallenge", () => {
  it("matches the RFC 7636 appendix B test vector", async () => {
    const challenge = await computeCodeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});

describe("buildAuthUrl", () => {
  it("points at openrouter.ai/auth with callback, challenge, and S256 method", () => {
    const url = new URL(buildAuthUrl("https://example.com/app", "abc123"));
    expect(url.origin).toBe("https://openrouter.ai");
    expect(url.pathname).toBe("/auth");
    expect(url.searchParams.get("callback_url")).toBe("https://example.com/app");
    expect(url.searchParams.get("code_challenge")).toBe("abc123");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });
});
