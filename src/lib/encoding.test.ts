import { describe, expect, it } from "vitest";
import { bufferToBase64, bufferToBase64Chunked, utf8ByteLength, utf8Encode } from "./encoding";

function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

describe("bufferToBase64", () => {
  // The 0x8000 chunking in the fallback is the risky part — round-trip below,
  // at, and above the chunk boundary, and check the native path agrees.
  for (const size of [0, 1, 0x7fff, 0x8000, 0x8001, 0x20000 + 17]) {
    it(`round-trips ${size} bytes`, () => {
      const bytes = new Uint8Array(size);
      for (let i = 0; i < size; i++) bytes[i] = (i * 31) % 256;
      const chunked = bufferToBase64Chunked(bytes);
      expect(base64ToBytes(chunked)).toEqual(bytes);
      expect(bufferToBase64(bytes)).toBe(chunked);
    });
  }

  it("round-trips multibyte UTF-8 content", () => {
    const text = "héllo 世界 🎬".repeat(5000);
    const bytes = utf8Encode(text);
    const decoded = new TextDecoder().decode(base64ToBytes(bufferToBase64(bytes)));
    expect(decoded).toBe(text);
  });
});

describe("utf8ByteLength", () => {
  it("counts bytes, not code units", () => {
    expect(utf8ByteLength("")).toBe(0);
    expect(utf8ByteLength("abc")).toBe(3);
    expect(utf8ByteLength("é")).toBe(2);
    expect(utf8ByteLength("世")).toBe(3);
    expect(utf8ByteLength("🎬")).toBe(4);
  });
});
