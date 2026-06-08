import { describe, test, expect } from "bun:test";
import { validateLogin } from "../src/login";

describe("validateLogin — existing rules (regression)", () => {
  test("valid creds pass", () => {
    expect(validateLogin("alice", "longenoughpassword").ok).toBe(true);
  });

  test("missing username", () => {
    expect(validateLogin("", "longenoughpassword")).toEqual({
      ok: false,
      reason: "missing username",
    });
  });

  test("password too short (non-empty)", () => {
    expect(validateLogin("alice", "short")).toEqual({ ok: false, reason: "password too short" });
  });
});
