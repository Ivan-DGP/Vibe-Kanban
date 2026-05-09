import { describe, test, expect } from "bun:test";
import { escapeAttr } from "../src/escape";

describe("escapeAttr — entity escapes must not be re-escaped (target)", () => {
  test("standalone less-than becomes &lt; (single-pass entity)", () => {
    expect(escapeAttr("<")).toBe("&lt;");
  });

  test("simple tag-like input becomes &lt;a&gt;, not &amp;lt;a&amp;gt;", () => {
    expect(escapeAttr("<a>")).toBe("&lt;a&gt;");
  });

  test("script tag is escaped without double-escaping the entity prefixes", () => {
    expect(escapeAttr("<script>alert(1)</script>")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  test("ampersand mixed with other escapable chars: each char is escaped exactly once", () => {
    expect(escapeAttr("a&<b")).toBe("a&amp;&lt;b");
  });

  test("double-quote and single-quote escape independently", () => {
    expect(escapeAttr('say "hi"')).toBe("say &quot;hi&quot;");
    expect(escapeAttr("o'brien")).toBe("o&#39;brien");
  });

  test("idempotent on entity-prefixed input — escaping once should not produce &amp;lt;", () => {
    // Input "<3" — naive last-replace-amp would give "&amp;lt;3"; correct gives "&lt;3"
    expect(escapeAttr("<3")).toBe("&lt;3");
    // and a pre-existing entity-looking sequence in the input is treated as raw text
    expect(escapeAttr("&lt;")).toBe("&amp;lt;");
  });
});
