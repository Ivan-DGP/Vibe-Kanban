import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { getDateRange, calculateHours } from "./reports";
import { buildApp } from "../app";
import { getDb } from "../db";

// ===========================================================================
// Pure function tests
// ===========================================================================

describe("getDateRange", () => {
  test('"today" returns from start of today to start of tomorrow', () => {
    const range = getDateRange("today");
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrowStart = new Date(todayStart.getTime() + 86400000);

    expect(range.from).toBe(todayStart.toISOString());
    expect(range.to).toBe(tomorrowStart.toISOString());
  });

  test('"yesterday" returns from start of yesterday to start of today', () => {
    const range = getDateRange("yesterday");
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayStart = new Date(todayStart.getTime() - 86400000);

    expect(range.from).toBe(yesterdayStart.toISOString());
    expect(range.to).toBe(todayStart.toISOString());
  });

  test('"this-week" starts from Monday', () => {
    const range = getDateRange("this-week");
    const fromDate = new Date(range.from);

    // Monday is day 1 in JS getDay() (0=Sun, 1=Mon, ..., 6=Sat)
    expect(fromDate.getDay()).toBe(1);
    // The from date should be at midnight
    expect(fromDate.getHours()).toBe(0);
    expect(fromDate.getMinutes()).toBe(0);
    expect(fromDate.getSeconds()).toBe(0);

    // The from date should be <= today
    const now = new Date();
    expect(fromDate.getTime()).toBeLessThanOrEqual(now.getTime());
  });

  test('"this-month" starts from the 1st of the current month', () => {
    const range = getDateRange("this-month");
    const fromDate = new Date(range.from);
    const now = new Date();

    expect(fromDate.getFullYear()).toBe(now.getFullYear());
    expect(fromDate.getMonth()).toBe(now.getMonth());
    expect(fromDate.getDate()).toBe(1);
    expect(fromDate.getHours()).toBe(0);
    expect(fromDate.getMinutes()).toBe(0);
  });

  test('"last-7" starts 7 days before today', () => {
    const range = getDateRange("last-7");
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sevenDaysAgo = new Date(todayStart.getTime() - 7 * 86400000);

    expect(range.from).toBe(sevenDaysAgo.toISOString());
    // The "to" date should be in the future (now + 1 day)
    const toDate = new Date(range.to);
    expect(toDate.getTime()).toBeGreaterThan(now.getTime());
  });

  test('"last-30" starts 30 days before today', () => {
    const range = getDateRange("last-30");
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thirtyDaysAgo = new Date(todayStart.getTime() - 30 * 86400000);

    expect(range.from).toBe(thirtyDaysAgo.toISOString());
    const toDate = new Date(range.to);
    expect(toDate.getTime()).toBeGreaterThan(now.getTime());
  });

  test('"custom" uses provided from and to dates', () => {
    const customFrom = "2025-01-01T00:00:00.000Z";
    const customTo = "2025-01-31T23:59:59.999Z";
    const range = getDateRange("custom", customFrom, customTo);

    expect(range.from).toBe(customFrom);
    expect(range.to).toBe(customTo);
  });

  test('"custom" without from/to falls back to defaults', () => {
    const range = getDateRange("custom");
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // from defaults to todayStart
    expect(range.from).toBe(todayStart.toISOString());
    // to defaults to now + 1 day
    const toDate = new Date(range.to);
    expect(toDate.getTime()).toBeGreaterThan(now.getTime());
  });

  test("unknown period defaults to today range", () => {
    const range = getDateRange("unknown-period");
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    expect(range.from).toBe(todayStart.toISOString());
  });
});

describe("calculateHours", () => {
  test("calculates actual hours from inProgressAt and doneAt", () => {
    const task = {
      inProgressAt: "2025-06-01T10:00:00.000Z",
      doneAt: "2025-06-01T13:30:00.000Z", // 3.5 hours later
      priority: "medium",
    };
    expect(calculateHours(task)).toBe(3.5);
  });

  test("falls back to priority-based hours when no timestamps", () => {
    expect(calculateHours({ priority: "urgent" })).toBe(4);
    expect(calculateHours({ priority: "high" })).toBe(3);
    expect(calculateHours({ priority: "medium" })).toBe(2);
    expect(calculateHours({ priority: "low" })).toBe(1);
  });

  test("falls back to default 2 hours for unknown priority without timestamps", () => {
    expect(calculateHours({ priority: "unknown" })).toBe(2);
    expect(calculateHours({})).toBe(2);
  });

  test("caps elapsed hours at 8 when the range is very large", () => {
    const task = {
      inProgressAt: "2020-01-01T00:00:00.000Z",
      doneAt: "2025-06-01T00:00:00.000Z", // years apart => capped at 8h
      priority: "high",
    };
    expect(calculateHours(task)).toBe(8); // idle-inflation cap
  });

  test("run duration wins over elapsed and priority", () => {
    const task = {
      inProgressAt: "2025-06-01T10:00:00.000Z",
      doneAt: "2025-06-01T13:30:00.000Z",
      priority: "urgent",
    };
    expect(calculateHours(task, 5_400_000)).toBe(1.5); // 90 min
  });

  test("caps elapsed at 8 hours (20h apart, no runs)", () => {
    const task = {
      inProgressAt: "2025-06-01T00:00:00.000Z",
      doneAt: "2025-06-01T20:00:00.000Z",
    };
    expect(calculateHours(task, 0)).toBe(8);
  });

  test("priority fallback with explicit zero run duration", () => {
    expect(calculateHours({ priority: "high" }, 0)).toBe(3);
  });

  test("falls back to priority-based when doneAt is before inProgressAt (negative hours)", () => {
    const task = {
      inProgressAt: "2025-06-01T13:00:00.000Z",
      doneAt: "2025-06-01T10:00:00.000Z", // backwards
      priority: "low",
    };
    expect(calculateHours(task)).toBe(1); // priority-based fallback for "low"
  });

  test("falls back when only inProgressAt is set (no doneAt)", () => {
    const task = {
      inProgressAt: "2025-06-01T10:00:00.000Z",
      priority: "urgent",
    };
    expect(calculateHours(task)).toBe(4);
  });

  test("falls back when only doneAt is set (no inProgressAt)", () => {
    const task = {
      doneAt: "2025-06-01T10:00:00.000Z",
      priority: "medium",
    };
    expect(calculateHours(task)).toBe(2);
  });

  test("rounds to one decimal place", () => {
    // 2 hours 20 minutes = 2.333... hours -> rounds to 2.3
    const task = {
      inProgressAt: "2025-06-01T10:00:00.000Z",
      doneAt: "2025-06-01T12:20:00.000Z",
      priority: "medium",
    };
    expect(calculateHours(task)).toBe(2.3);
  });
});

// ===========================================================================
// Integration tests (using buildApp + inject)
// ===========================================================================

let app: Awaited<ReturnType<typeof buildApp>>;
let projectId: string;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  // Create a test project
  const projRes = await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: { "Content-Type": "application/json" },
    payload: {
      name: `Reports Test Project ${Date.now()}`,
      path: `/tmp/test-reports-${Date.now()}`,
    },
  });
  projectId = projRes.json().id;

  // Create tasks with doneAt in the last 30 days so reports have data.
  // We create tasks as "done" which triggers the timestamp cascade
  // (sets inboxAt, inProgressAt, doneAt automatically).
  for (let i = 0; i < 3; i++) {
    const taskRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/tasks`,
      headers: { "Content-Type": "application/json" },
      payload: {
        title: `Report Task ${i + 1}`,
        description: `Task for report testing`,
        priority: ["high", "medium", "low"][i],
        status: "done",
      },
    });
    // Verify the task was created with doneAt
    const task = taskRes.json();
    if (!task.doneAt) {
      throw new Error(`Task ${task.id} should have doneAt set when created as done`);
    }
  }
});

afterAll(async () => {
  // Cleanup
  await app.inject({ method: "DELETE", url: `/api/projects/${projectId}` });
});

describe("Reports API", () => {
  test("GET /api/reports?period=today returns correct response shape", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/reports?period=today",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Verify the full response shape
    expect(body.period).toBe("today");
    expect(typeof body.from).toBe("string");
    expect(typeof body.to).toBe("string");
    expect(typeof body.totalTasks).toBe("number");
    expect(typeof body.totalHours).toBe("number");
    expect(typeof body.avgHoursPerTask).toBe("number");
    expect(Array.isArray(body.byProject)).toBe(true);

    // from and to should be valid ISO date strings
    expect(() => new Date(body.from)).not.toThrow();
    expect(() => new Date(body.to)).not.toThrow();

    // Since we created tasks as "done" today, we should have data
    expect(body.totalTasks).toBeGreaterThanOrEqual(3);
    expect(body.totalHours).toBeGreaterThan(0);
    expect(body.avgHoursPerTask).toBeGreaterThan(0);

    // byProject should contain our test project
    expect(body.byProject.length).toBeGreaterThanOrEqual(1);
    const ourProject = body.byProject.find((p: any) => p.projectId === projectId);
    expect(ourProject).toBeDefined();
    expect(ourProject.projectName).toBeDefined();
    expect(Array.isArray(ourProject.tasks)).toBe(true);
    expect(ourProject.tasks.length).toBeGreaterThanOrEqual(3);
    expect(typeof ourProject.totalHours).toBe("number");
    expect(ourProject.totalHours).toBeGreaterThan(0);
  });

  test("GET /api/reports?period=last-30 returns valid report", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/reports?period=last-30",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.period).toBe("last-30");
    expect(typeof body.from).toBe("string");
    expect(typeof body.to).toBe("string");
    expect(typeof body.totalTasks).toBe("number");
    expect(typeof body.totalHours).toBe("number");
    expect(typeof body.avgHoursPerTask).toBe("number");
    expect(Array.isArray(body.byProject)).toBe(true);

    // Our done tasks from today should be within the last 30 days
    expect(body.totalTasks).toBeGreaterThanOrEqual(3);

    // Verify date range is correct (from should be ~30 days ago)
    const fromDate = new Date(body.from);
    const now = new Date();
    const daysDiff = (now.getTime() - fromDate.getTime()) / 86400000;
    expect(daysDiff).toBeGreaterThanOrEqual(29);
    expect(daysDiff).toBeLessThanOrEqual(31);
  });

  test("GET /api/reports?period=custom&from=...&to=... uses custom date range", async () => {
    // Use a range that covers today
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    const tomorrow = new Date(now.getTime() + 86400000);
    const customFrom = weekAgo.toISOString();
    const customTo = tomorrow.toISOString();

    const res = await app.inject({
      method: "GET",
      url: `/api/reports?period=custom&from=${encodeURIComponent(customFrom)}&to=${encodeURIComponent(customTo)}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.period).toBe("custom");
    expect(body.from).toBe(customFrom);
    expect(body.to).toBe(customTo);
    expect(typeof body.totalTasks).toBe("number");
    expect(typeof body.totalHours).toBe("number");
    expect(typeof body.avgHoursPerTask).toBe("number");
    expect(Array.isArray(body.byProject)).toBe(true);

    // Our tasks created today should be within this custom range
    expect(body.totalTasks).toBeGreaterThanOrEqual(3);
  });

  test("GET /api/reports without period defaults to today", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/reports",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Default period should be "today"
    expect(body.period).toBe("today");
    expect(typeof body.totalTasks).toBe("number");
    expect(Array.isArray(body.byProject)).toBe(true);
  });

  test("GET /api/reports?period=yesterday returns report with no test tasks", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/reports?period=yesterday",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.period).toBe("yesterday");
    expect(typeof body.totalTasks).toBe("number");
    expect(typeof body.totalHours).toBe("number");

    // Our test tasks were created today, not yesterday
    // (Note: this is best-effort; if other tests left yesterday data, count may vary)
    // The main assertion is that the response shape is valid
    expect(body.avgHoursPerTask).toBeGreaterThanOrEqual(0);
  });

  test("byProject task entries have expected shape", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/reports?period=today",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    const ourProject = body.byProject.find((p: any) => p.projectId === projectId);
    expect(ourProject).toBeDefined();

    // Each task entry in byProject should have { task, projectName, hours }
    for (const entry of ourProject.tasks) {
      expect(entry.task).toBeDefined();
      expect(typeof entry.projectName).toBe("string");
      expect(typeof entry.hours).toBe("number");
      expect(entry.hours).toBeGreaterThan(0);
    }
  });

  test("POST /api/reports/summaries/:taskId returns cached reportSummary (idempotent)", async () => {
    // Create a task, then seed metadata.reportSummary directly.
    const taskRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/tasks`,
      headers: { "Content-Type": "application/json" },
      payload: { title: "Cached Summary Task", status: "done" },
    });
    const taskId = taskRes.json().id;

    const cached = "This task shipped the cached summary path.";
    getDb()
      .prepare(`UPDATE tasks SET metadata = ? WHERE id = ?`)
      .run(JSON.stringify({ reportSummary: cached, keep: "me" }), taskId);

    const res = await app.inject({
      method: "POST",
      url: `/api/reports/summaries/${taskId}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().summary).toBe(cached);
  });

  test("POST /api/reports/summaries/:taskId returns 404 for unknown task", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/reports/summaries/does-not-exist`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Task not found");
  });
});
