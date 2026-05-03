import { describe, test, expect } from "bun:test";
import { composeTaskText } from "./taskEmbedder";

describe("composeTaskText", () => {
  test("includes title only when other fields are empty", () => {
    const text = composeTaskText({
      projectId: "p",
      taskId: "t",
      title: "Add login flow",
    });
    expect(text).toContain("# Add login flow");
    expect(text).not.toContain("Status:");
    expect(text).not.toContain("Prompt:");
  });

  test("includes status when provided", () => {
    const text = composeTaskText({
      projectId: "p",
      taskId: "t",
      title: "Foo",
      status: "in_progress",
    });
    expect(text).toContain("Status: in_progress");
  });

  test("includes description and prompt when provided", () => {
    const text = composeTaskText({
      projectId: "p",
      taskId: "t",
      title: "Add OAuth",
      description: "Support GitHub login",
      prompt: "Implement Passport.js GitHub strategy",
    });
    expect(text).toContain("# Add OAuth");
    expect(text).toContain("Support GitHub login");
    expect(text).toContain("Prompt:");
    expect(text).toContain("Passport.js GitHub strategy");
  });

  test("trims whitespace and ignores empty fields", () => {
    const text = composeTaskText({
      projectId: "p",
      taskId: "t",
      title: "  Trim me  ",
      description: "   ",
      prompt: "",
    });
    expect(text).toContain("# Trim me");
    expect(text).not.toContain("Prompt:");
  });

  test("handles null fields gracefully", () => {
    const text = composeTaskText({
      projectId: "p",
      taskId: "t",
      title: "Hello",
      description: null,
      prompt: null,
      status: null,
    });
    expect(text).toBe("# Hello");
  });
});
