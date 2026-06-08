import { describe, test, expect } from "bun:test";
import { parseWikilinks, slugify, isEscapingTarget } from "./wikilinks";

describe("parseWikilinks", () => {
  test("extracts a simple [[target]]", () => {
    expect(parseWikilinks("see [[architecture]] doc")).toEqual(["architecture"]);
  });

  test("supports [[target|alias]] — keeps target only", () => {
    expect(parseWikilinks("see [[architecture|the arch]]")).toEqual(["architecture"]);
  });

  test("strips [[target#heading]] anchor", () => {
    expect(parseWikilinks("[[spec#section-2]]")).toEqual(["spec"]);
  });

  test("de-dupes repeated targets preserving order", () => {
    expect(parseWikilinks("[[a]] [[b]] [[a]]")).toEqual(["a", "b"]);
  });

  test("ignores links inside fenced code blocks", () => {
    const md = "real [[a]]\n```\ncode [[b]]\n```\n";
    expect(parseWikilinks(md)).toEqual(["a"]);
  });

  test("ignores links inside inline code", () => {
    expect(parseWikilinks("text `[[ignored]]` and [[kept]]")).toEqual(["kept"]);
  });

  test("trims whitespace inside brackets", () => {
    expect(parseWikilinks("[[  spaced name  ]]")).toEqual(["spaced name"]);
  });

  test("skips empty targets and returns [] for empty input", () => {
    expect(parseWikilinks("[[]] [[ | alias ]]")).toEqual([]);
    expect(parseWikilinks("")).toEqual([]);
  });
});

describe("slugify", () => {
  test("lowercases, drops extension, spaces→hyphens", () => {
    expect(slugify("My Spec.md")).toBe("my-spec");
  });

  test("collapses multiple spaces and trims hyphens", () => {
    expect(slugify("  Hello   World  ")).toBe("hello-world");
  });

  test("only strips a single trailing extension", () => {
    expect(slugify("notes.final.md")).toBe("notes.final");
  });

  test("no extension is left intact", () => {
    expect(slugify("Architecture")).toBe("architecture");
  });
});

describe("isEscapingTarget", () => {
  test("flags parent traversal", () => {
    expect(isEscapingTarget("../../x")).toBe(true);
    expect(isEscapingTarget("..")).toBe(true);
  });

  test("flags path separators", () => {
    expect(isEscapingTarget("dir/file")).toBe(true);
    expect(isEscapingTarget("dir\\file")).toBe(true);
  });

  test("plain names are not escaping", () => {
    expect(isEscapingTarget("architecture")).toBe(false);
    expect(isEscapingTarget("my spec")).toBe(false);
  });
});
