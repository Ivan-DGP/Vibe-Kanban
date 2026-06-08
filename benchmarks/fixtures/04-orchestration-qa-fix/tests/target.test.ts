import { describe, test, expect } from "bun:test";
import { validateLogin } from "../src/login";

describe("validateLogin — empty password (target)", () => {
  test("empty password is rejected with explicit reason", () => {
    const r = validateLogin("alice", "");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("password required");
  });
});
