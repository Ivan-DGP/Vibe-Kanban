import { describe, test, expect } from "bun:test";
import { composeGraphNodeText } from "./graphNodeEmbedder";

describe("composeGraphNodeText", () => {
  test("includes label only when other fields are empty", () => {
    const text = composeGraphNodeText({
      projectId: "p",
      nodeId: "n",
      label: "Auth Service",
    });
    expect(text).toContain("# Auth Service");
    expect(text).not.toContain("Type:");
  });

  test("includes type when provided", () => {
    const text = composeGraphNodeText({
      projectId: "p",
      nodeId: "n",
      label: "Postgres",
      type: "technology",
    });
    expect(text).toContain("Type: technology");
  });

  test("includes description when provided", () => {
    const text = composeGraphNodeText({
      projectId: "p",
      nodeId: "n",
      label: "Login Risk",
      type: "risk",
      description: "Session tokens stored insecurely",
    });
    expect(text).toContain("# Login Risk");
    expect(text).toContain("Type: risk");
    expect(text).toContain("Session tokens stored insecurely");
  });

  test("trims whitespace and ignores empty fields", () => {
    const text = composeGraphNodeText({
      projectId: "p",
      nodeId: "n",
      label: "  Trim me  ",
      description: "   ",
    });
    expect(text).toContain("# Trim me");
    expect(text).not.toContain("Type:");
  });

  test("handles null fields gracefully", () => {
    const text = composeGraphNodeText({
      projectId: "p",
      nodeId: "n",
      label: "Hello",
      type: null,
      description: null,
    });
    expect(text).toBe("# Hello");
  });
});
