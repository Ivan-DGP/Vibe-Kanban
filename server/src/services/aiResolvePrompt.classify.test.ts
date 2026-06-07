import { describe, test, expect } from "bun:test";
import { classifyTaskProfile, estimateComplexity } from "./aiResolvePrompt";

describe("classifyTaskProfile - extended coverage", () => {
  test("classifies documentation tasks", () => {
    expect(
      classifyTaskProfile({ title: "Update README docs", description: null, prompt: null }),
    ).toBe("docs");
    expect(
      classifyTaskProfile({ title: "Write API documentation", description: null, prompt: null }),
    ).toBe("docs");
  });

  test("classifies quick-fix tasks", () => {
    expect(
      classifyTaskProfile({ title: "Fix typo in header", description: null, prompt: null }),
    ).toBe("quick-fix");
    expect(
      classifyTaskProfile({
        title: "Update env var for production",
        description: null,
        prompt: null,
      }),
    ).toBe("quick-fix");
    expect(
      classifyTaskProfile({
        title: "Rename constant to follow convention",
        description: null,
        prompt: null,
      }),
    ).toBe("quick-fix");
    expect(
      classifyTaskProfile({ title: "Version bump to 2.0", description: null, prompt: null }),
    ).toBe("quick-fix");
  });

  test("classifies bug-fix tasks", () => {
    expect(
      classifyTaskProfile({ title: "Fix crash on empty input", description: null, prompt: null }),
    ).toBe("bug-fix");
    expect(
      classifyTaskProfile({
        title: "Task list shows wrong data",
        description: "It shows incorrect results",
        prompt: null,
      }),
    ).toBe("bug-fix");
    expect(
      classifyTaskProfile({ title: "Error when saving settings", description: null, prompt: null }),
    ).toBe("bug-fix");
  });

  test("classifies refactor tasks", () => {
    expect(
      classifyTaskProfile({ title: "Refactor auth middleware", description: null, prompt: null }),
    ).toBe("refactor");
    expect(
      classifyTaskProfile({ title: "Clean up terminal service", description: null, prompt: null }),
    ).toBe("refactor");
    expect(
      classifyTaskProfile({
        title: "Extract helper functions from route",
        description: null,
        prompt: null,
      }),
    ).toBe("refactor");
  });

  test("defaults to feature for ambiguous tasks", () => {
    expect(
      classifyTaskProfile({ title: "Implement dark mode", description: null, prompt: null }),
    ).toBe("feature");
    expect(
      classifyTaskProfile({ title: "Add drag and drop support", description: null, prompt: null }),
    ).toBe("feature");
  });

  test("doc task with fix signal is not classified as docs", () => {
    expect(
      classifyTaskProfile({ title: "Fix docs build script", description: null, prompt: null }),
    ).not.toBe("docs");
  });

  test("uses description and prompt for classification", () => {
    expect(
      classifyTaskProfile({
        title: "Update the module",
        description: "This is broken and has a regression",
        prompt: null,
      }),
    ).toBe("bug-fix");
  });
});

describe("estimateComplexity - extended coverage", () => {
  test("empty task is small", () => {
    expect(estimateComplexity({ title: "x", description: null, prompt: null })).toBe("small");
  });

  test("medium-length task is medium", () => {
    expect(
      estimateComplexity({
        title: "Add a new button to the sidebar",
        description:
          "The sidebar needs a settings button that opens the config panel when clicked. Should use the existing icon library.",
        prompt: null,
      }),
    ).toBe("medium");
  });

  test("task with long prompt is large", () => {
    expect(
      estimateComplexity({
        title: "Major feature",
        description: "Lots to do",
        prompt: "x".repeat(250),
      }),
    ).toBe("large");
  });

  test("task with very long description is large", () => {
    expect(
      estimateComplexity({
        title: "Complex feature",
        description: "d".repeat(500),
        prompt: null,
      }),
    ).toBe("large");
  });

  test("boundary: 99 chars is small", () => {
    expect(
      estimateComplexity({
        title: "a".repeat(99),
        description: null,
        prompt: null,
      }),
    ).toBe("small");
  });

  test("boundary: 100 chars without prompt is medium", () => {
    expect(
      estimateComplexity({
        title: "a".repeat(100),
        description: null,
        prompt: null,
      }),
    ).toBe("medium");
  });
});
