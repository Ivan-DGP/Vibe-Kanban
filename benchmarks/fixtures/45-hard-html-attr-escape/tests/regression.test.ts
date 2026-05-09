import { describe, test, expect } from "bun:test";
import { escapeAttr } from "../src/escape";

describe("escapeAttr — base contract (regression)", () => {
  test("empty string returns empty string", () => {
    expect(escapeAttr("")).toBe("");
  });

  test("plain ASCII passes through unchanged", () => {
    expect(escapeAttr("hello world")).toBe("hello world");
    expect(escapeAttr("alice@example.com")).toBe("alice@example.com");
  });

  test("non-ASCII passes through unchanged (no transcoding)", () => {
    expect(escapeAttr("中文")).toBe("中文");
    expect(escapeAttr("🚀 launch")).toBe("🚀 launch");
  });

  test("a single ampersand becomes &amp;", () => {
    expect(escapeAttr("&")).toBe("&amp;");
  });

  test("multiple bare ampersands all become &amp;", () => {
    expect(escapeAttr("a&b&c")).toBe("a&amp;b&amp;c");
  });

  test("output never contains a literal & that is not part of an entity", () => {
    const out = escapeAttr("hello & world");
    // every & in the output is followed by a recognized entity terminator
    const bareAmp = /&(?!(amp|lt|gt|quot|#39);)/.test(out);
    expect(bareAmp).toBe(false);
  });
});
