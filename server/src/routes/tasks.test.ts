import { describe, test, expect } from "bun:test";
import { applyTimestampCascade } from "../services/taskModel";
import type { Task, TaskStatus } from "@vibe-kanban/shared";

/** Helper to build a partial task with optional pre-existing timestamps */
function makeTask(overrides: Partial<Task> = {}): Partial<Task> {
  return { ...overrides };
}

describe("applyTimestampCascade", () => {
  // ------------------------------------------------------------------
  // backlog status
  // ------------------------------------------------------------------
  describe("backlog status", () => {
    test("sets inboxAt when missing", () => {
      const result = applyTimestampCascade(makeTask(), "backlog");
      expect(result).toHaveProperty("inboxAt");
      expect(result).toHaveProperty("updatedAt");
    });

    test("does not overwrite existing inboxAt", () => {
      const existing = "2025-01-01T00:00:00.000Z";
      const result = applyTimestampCascade(makeTask({ inboxAt: existing }), "backlog");
      expect(result).not.toHaveProperty("inboxAt");
      expect(result).toHaveProperty("updatedAt");
    });

    test("does not set inProgressAt, doneAt, approvedAt, or archivedAt", () => {
      const result = applyTimestampCascade(makeTask(), "backlog");
      expect(result).not.toHaveProperty("inProgressAt");
      expect(result).not.toHaveProperty("doneAt");
      expect(result).not.toHaveProperty("approvedAt");
      expect(result).not.toHaveProperty("archivedAt");
    });
  });

  // ------------------------------------------------------------------
  // todo status
  // ------------------------------------------------------------------
  describe("todo status", () => {
    test("sets inboxAt when missing", () => {
      const result = applyTimestampCascade(makeTask(), "todo");
      expect(result).toHaveProperty("inboxAt");
      expect(result).toHaveProperty("updatedAt");
    });

    test("does not overwrite existing inboxAt", () => {
      const existing = "2025-01-01T00:00:00.000Z";
      const result = applyTimestampCascade(makeTask({ inboxAt: existing }), "todo");
      expect(result).not.toHaveProperty("inboxAt");
    });

    test("does not set inProgressAt, doneAt, approvedAt, or archivedAt", () => {
      const result = applyTimestampCascade(makeTask(), "todo");
      expect(result).not.toHaveProperty("inProgressAt");
      expect(result).not.toHaveProperty("doneAt");
      expect(result).not.toHaveProperty("approvedAt");
      expect(result).not.toHaveProperty("archivedAt");
    });
  });

  // ------------------------------------------------------------------
  // in_progress status
  // ------------------------------------------------------------------
  describe("in_progress status", () => {
    test("sets inboxAt and inProgressAt when both missing", () => {
      const result = applyTimestampCascade(makeTask(), "in_progress");
      expect(result).toHaveProperty("inboxAt");
      expect(result).toHaveProperty("inProgressAt");
      expect(result).toHaveProperty("updatedAt");
    });

    test("preserves existing inboxAt", () => {
      const existing = "2025-01-01T00:00:00.000Z";
      const result = applyTimestampCascade(makeTask({ inboxAt: existing }), "in_progress");
      expect(result).not.toHaveProperty("inboxAt");
      expect(result).toHaveProperty("inProgressAt");
    });

    test("preserves existing inProgressAt", () => {
      const existing = "2025-02-01T00:00:00.000Z";
      const result = applyTimestampCascade(
        makeTask({ inboxAt: "2025-01-01T00:00:00.000Z", inProgressAt: existing }),
        "in_progress",
      );
      expect(result).not.toHaveProperty("inboxAt");
      expect(result).not.toHaveProperty("inProgressAt");
    });

    test("does not set doneAt, approvedAt, or archivedAt", () => {
      const result = applyTimestampCascade(makeTask(), "in_progress");
      expect(result).not.toHaveProperty("doneAt");
      expect(result).not.toHaveProperty("approvedAt");
      expect(result).not.toHaveProperty("archivedAt");
    });
  });

  // ------------------------------------------------------------------
  // done status
  // ------------------------------------------------------------------
  describe("done status", () => {
    test("sets inboxAt, inProgressAt, and doneAt when all missing", () => {
      const result = applyTimestampCascade(makeTask(), "done");
      expect(result).toHaveProperty("inboxAt");
      expect(result).toHaveProperty("inProgressAt");
      expect(result).toHaveProperty("doneAt");
      expect(result).toHaveProperty("updatedAt");
    });

    test("preserves all existing timestamps", () => {
      const result = applyTimestampCascade(
        makeTask({
          inboxAt: "2025-01-01T00:00:00.000Z",
          inProgressAt: "2025-02-01T00:00:00.000Z",
          doneAt: "2025-03-01T00:00:00.000Z",
        }),
        "done",
      );
      expect(result).not.toHaveProperty("inboxAt");
      expect(result).not.toHaveProperty("inProgressAt");
      expect(result).not.toHaveProperty("doneAt");
      // updatedAt is always set
      expect(result).toHaveProperty("updatedAt");
    });

    test("fills in only missing timestamps in the cascade", () => {
      const result = applyTimestampCascade(
        makeTask({ inboxAt: "2025-01-01T00:00:00.000Z" }),
        "done",
      );
      expect(result).not.toHaveProperty("inboxAt");
      expect(result).toHaveProperty("inProgressAt");
      expect(result).toHaveProperty("doneAt");
    });

    test("does not set approvedAt or archivedAt", () => {
      const result = applyTimestampCascade(makeTask(), "done");
      expect(result).not.toHaveProperty("approvedAt");
      expect(result).not.toHaveProperty("archivedAt");
    });
  });

  // ------------------------------------------------------------------
  // approved status
  // ------------------------------------------------------------------
  describe("approved status", () => {
    test("sets inboxAt, inProgressAt, doneAt, and approvedAt when all missing", () => {
      const result = applyTimestampCascade(makeTask(), "approved");
      expect(result).toHaveProperty("inboxAt");
      expect(result).toHaveProperty("inProgressAt");
      expect(result).toHaveProperty("doneAt");
      expect(result).toHaveProperty("approvedAt");
      expect(result).toHaveProperty("updatedAt");
    });

    test("preserves all existing timestamps", () => {
      const result = applyTimestampCascade(
        makeTask({
          inboxAt: "2025-01-01T00:00:00.000Z",
          inProgressAt: "2025-02-01T00:00:00.000Z",
          doneAt: "2025-03-01T00:00:00.000Z",
          approvedAt: "2025-04-01T00:00:00.000Z",
        }),
        "approved",
      );
      expect(result).not.toHaveProperty("inboxAt");
      expect(result).not.toHaveProperty("inProgressAt");
      expect(result).not.toHaveProperty("doneAt");
      expect(result).not.toHaveProperty("approvedAt");
      expect(result).toHaveProperty("updatedAt");
    });

    test("fills in only missing timestamps", () => {
      const result = applyTimestampCascade(
        makeTask({
          inboxAt: "2025-01-01T00:00:00.000Z",
          inProgressAt: "2025-02-01T00:00:00.000Z",
        }),
        "approved",
      );
      expect(result).not.toHaveProperty("inboxAt");
      expect(result).not.toHaveProperty("inProgressAt");
      expect(result).toHaveProperty("doneAt");
      expect(result).toHaveProperty("approvedAt");
    });

    test("does not set archivedAt", () => {
      const result = applyTimestampCascade(makeTask(), "approved");
      expect(result).not.toHaveProperty("archivedAt");
    });
  });

  // ------------------------------------------------------------------
  // archived status
  // ------------------------------------------------------------------
  describe("archived status", () => {
    test("sets all timestamps when all missing", () => {
      const result = applyTimestampCascade(makeTask(), "archived");
      expect(result).toHaveProperty("inboxAt");
      expect(result).toHaveProperty("inProgressAt");
      expect(result).toHaveProperty("doneAt");
      expect(result).toHaveProperty("approvedAt");
      expect(result).toHaveProperty("archivedAt");
      expect(result).toHaveProperty("updatedAt");
    });

    test("preserves all existing timestamps", () => {
      const result = applyTimestampCascade(
        makeTask({
          inboxAt: "2025-01-01T00:00:00.000Z",
          inProgressAt: "2025-02-01T00:00:00.000Z",
          doneAt: "2025-03-01T00:00:00.000Z",
          approvedAt: "2025-04-01T00:00:00.000Z",
          archivedAt: "2025-05-01T00:00:00.000Z",
        }),
        "archived",
      );
      expect(result).not.toHaveProperty("inboxAt");
      expect(result).not.toHaveProperty("inProgressAt");
      expect(result).not.toHaveProperty("doneAt");
      expect(result).not.toHaveProperty("approvedAt");
      expect(result).not.toHaveProperty("archivedAt");
      expect(result).toHaveProperty("updatedAt");
    });

    test("fills in only missing timestamps", () => {
      const result = applyTimestampCascade(
        makeTask({
          inboxAt: "2025-01-01T00:00:00.000Z",
          inProgressAt: "2025-02-01T00:00:00.000Z",
          doneAt: "2025-03-01T00:00:00.000Z",
        }),
        "archived",
      );
      expect(result).not.toHaveProperty("inboxAt");
      expect(result).not.toHaveProperty("inProgressAt");
      expect(result).not.toHaveProperty("doneAt");
      expect(result).toHaveProperty("approvedAt");
      expect(result).toHaveProperty("archivedAt");
      expect(result).toHaveProperty("updatedAt");
    });
  });

  // ------------------------------------------------------------------
  // updatedAt behavior
  // ------------------------------------------------------------------
  describe("updatedAt", () => {
    test("always includes updatedAt regardless of status", () => {
      const statuses: TaskStatus[] = [
        "backlog",
        "todo",
        "in_progress",
        "done",
        "approved",
        "archived",
      ];
      for (const status of statuses) {
        const result = applyTimestampCascade(makeTask(), status);
        expect(result).toHaveProperty("updatedAt");
        expect(typeof result.updatedAt).toBe("string");
      }
    });

    test("updatedAt is a valid ISO timestamp", () => {
      const result = applyTimestampCascade(makeTask(), "backlog");
      const parsed = new Date(result.updatedAt);
      expect(parsed.toISOString()).toBe(result.updatedAt);
    });
  });

  // ------------------------------------------------------------------
  // General invariants
  // ------------------------------------------------------------------
  describe("general invariants", () => {
    test("all returned timestamps share the same value", () => {
      const result = applyTimestampCascade(makeTask(), "archived");
      const ts = result.updatedAt;
      // Every timestamp in the result should be the same now() call
      for (const value of Object.values(result)) {
        expect(value).toBe(ts);
      }
    });

    test("returns only new timestamps, not existing ones", () => {
      const existing = "2025-01-01T00:00:00.000Z";
      const result = applyTimestampCascade(
        makeTask({ inboxAt: existing, inProgressAt: existing }),
        "done",
      );
      // Should have doneAt (new) and updatedAt, but NOT inboxAt or inProgressAt
      const keys = Object.keys(result);
      expect(keys).toContain("doneAt");
      expect(keys).toContain("updatedAt");
      expect(keys).not.toContain("inboxAt");
      expect(keys).not.toContain("inProgressAt");
    });

    test("empty task gets full cascade for archived", () => {
      const result = applyTimestampCascade({}, "archived");
      expect(Object.keys(result).sort()).toEqual(
        ["approvedAt", "archivedAt", "doneAt", "inProgressAt", "inboxAt", "updatedAt"].sort(),
      );
    });

    test("null timestamp fields are treated as missing", () => {
      // Task type has `string | null` for timestamps; null should trigger cascade
      const result = applyTimestampCascade(
        makeTask({ inboxAt: null, inProgressAt: null }),
        "in_progress",
      );
      expect(result).toHaveProperty("inboxAt");
      expect(result).toHaveProperty("inProgressAt");
    });
  });
});
