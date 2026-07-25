import { describe, expect, it } from "vitest";
import { buildFixMessage, stripMarkdownFence } from "./generation";

describe("stripMarkdownFence", () => {
  const html = "<!DOCTYPE html>\n<html><body>hi</body></html>";

  it("returns unfenced text unchanged", () => {
    expect(stripMarkdownFence(html)).toBe(html);
  });

  it("strips a ```html fence", () => {
    expect(stripMarkdownFence("```html\n" + html + "\n```")).toBe(html);
  });

  it("strips a bare ``` fence", () => {
    expect(stripMarkdownFence("```\n" + html + "\n```")).toBe(html);
  });

  it("strips an opening fence with no closing fence", () => {
    expect(stripMarkdownFence("```html\n" + html)).toBe(html);
  });

  it("strips a closing fence with no opening fence", () => {
    expect(stripMarkdownFence(html + "\n```")).toBe(html);
  });

  it("trims surrounding whitespace", () => {
    expect(stripMarkdownFence("\n\n  ```html\n" + html + "\n```  \n")).toBe(html);
  });

  it("handles empty input", () => {
    expect(stripMarkdownFence("")).toBe("");
    expect(stripMarkdownFence("```\n```")).toBe("");
  });
});

describe("buildFixMessage", () => {
  it("numbers each lint error with its code", () => {
    const msg = buildFixMessage([
      { code: "missing-doctype", message: "no doctype" },
      { code: "bad-clip", message: "clip missing data-duration" },
    ]);
    expect(msg).toContain("1. [missing-doctype] no doctype");
    expect(msg).toContain("2. [bad-clip] clip missing data-duration");
    expect(msg).toContain("Return ONLY the fixed HTML");
  });
});
