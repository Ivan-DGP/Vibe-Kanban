import { describe, test, expect, beforeAll, afterEach, afterAll } from "bun:test";
import crypto from "node:crypto";

const { buildApp } = await import("../app");
import { getDb } from "../db";

let app: Awaited<ReturnType<typeof buildApp>>;
let db: ReturnType<typeof getDb>;
const P1 = `__sup_route_1_${crypto.randomUUID()}__`;
const P2 = `__sup_route_2_${crypto.randomUUID()}__`;

const post = (url: string, payload: unknown = {}) =>
  app.inject({
    method: "POST",
    url,
    headers: { "Content-Type": "application/json" },
    payload: JSON.stringify(payload),
  });

beforeAll(async () => {
  // Kill-switch: skip grounding so the scan is deterministic + loads no model.
  process.env.VK_DISABLE_EMBEDDINGS = "1";
  app = await buildApp();
  await app.ready();
  db = getDb();
  for (const p of [P1, P2]) {
    db.prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)").run(p, p, `/tmp/${p}`);
  }
});

afterEach(() => {
  // Remove any supervisor tasks created in the test projects between cases.
  db.prepare("DELETE FROM tasks WHERE projectId IN (?, ?)").run(P1, P2);
});

afterAll(async () => {
  process.env.VK_DISABLE_EMBEDDINGS = undefined as unknown as string;
  delete process.env.VK_DISABLE_EMBEDDINGS;
  for (const p of [P1, P2]) {
    db.prepare("DELETE FROM roadmap_items WHERE projectId = ?").run(p);
    db.prepare("DELETE FROM project_memory WHERE projectId = ?").run(p);
    db.prepare("DELETE FROM tasks WHERE projectId = ?").run(p);
    db.prepare("DELETE FROM projects WHERE id = ?").run(p);
  }
  await app.close();
});

function seedRoadmap(projectId: string, title: string): string {
  const id = crypto.randomUUID();
  db.prepare(
    "INSERT INTO roadmap_items (id, projectId, title, status, createdAt) VALUES (?, ?, ?, 'planned', ?)",
  ).run(id, projectId, title, new Date().toISOString());
  return id;
}

describe("POST /api/supervisor/scan", () => {
  test("creates idempotent backlog tasks tagged origin=supervisor", async () => {
    const rmA = seedRoadmap(P1, "Ship widget API");
    const rmB = seedRoadmap(P2, "Add auth flow");

    const first = await post("/api/supervisor/scan", { limit: 50 });
    expect(first.statusCode).toBe(200);
    const body = first.json();
    // Both seeded planned-unlinked roadmap items become proposals/tasks.
    const createdKeys = body.proposals
      .filter((p: { created: boolean }) => p.created)
      .map((p: { signalKey: string }) => p.signalKey);
    expect(createdKeys).toContain(`roadmap:${rmA}`);
    expect(createdKeys).toContain(`roadmap:${rmB}`);

    // The emitted tasks are backlog + tagged.
    const tasks = db
      .prepare("SELECT projectId, status, metadata FROM tasks WHERE projectId IN (?, ?)")
      .all(P1, P2) as { projectId: string; status: string; metadata: string }[];
    expect(tasks.length).toBeGreaterThanOrEqual(2);
    for (const t of tasks) {
      expect(t.status).toBe("backlog");
      const m = JSON.parse(t.metadata);
      expect(m.origin).toBe("supervisor");
      expect(m.signalKey).toMatch(/^roadmap:/);
    }

    // A second scan re-proposes nothing (idempotent on signalKey).
    const second = (await post("/api/supervisor/scan", { limit: 50 })).json();
    const secondCreatedForOurs = second.proposals.filter(
      (p: { created: boolean; signalKey: string }) =>
        p.created && (p.signalKey === `roadmap:${rmA}` || p.signalKey === `roadmap:${rmB}`),
    );
    expect(secondCreatedForOurs.length).toBe(0);
    const stillTwo = db
      .prepare("SELECT COUNT(*) AS n FROM tasks WHERE projectId IN (?, ?)")
      .get(P1, P2) as { n: number };
    expect(stillTwo.n).toBe(2); // not duplicated
  });
});

describe("progressive draining (dedup before limit)", () => {
  test("re-scans surface the NEXT un-proposed signals instead of plateauing", async () => {
    // 3 candidate signals, scan limited to 2 → first scan proposes 2.
    seedRoadmap(P1, "work 1");
    seedRoadmap(P1, "work 2");
    seedRoadmap(P1, "work 3");

    const first = (await post("/api/supervisor/scan", { limit: 2 })).json();
    expect(first.created).toBeGreaterThanOrEqual(2);
    const afterFirst = (
      db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE projectId = ?").get(P1) as { n: number }
    ).n;
    expect(afterFirst).toBe(2);

    // Second scan (same limit) drains the remaining un-proposed signal.
    const second = (await post("/api/supervisor/scan", { limit: 2 })).json();
    expect(second.created).toBeGreaterThanOrEqual(1);
    const afterSecond = (
      db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE projectId = ?").get(P1) as { n: number }
    ).n;
    expect(afterSecond).toBe(3); // all 3 now proposed, none duplicated
  });
});

describe("GET /api/supervisor/proposals", () => {
  test("lists the supervisor-origin backlog tasks", async () => {
    seedRoadmap(P1, "Something to propose");
    await post("/api/supervisor/scan", { limit: 50 });

    const res = await app.inject({ method: "GET", url: "/api/supervisor/proposals" });
    expect(res.statusCode).toBe(200);
    const { proposals } = res.json();
    const mine = proposals.filter((t: { projectId: string }) => t.projectId === P1);
    expect(mine.length).toBeGreaterThanOrEqual(1);
    expect(mine[0].status).toBe("backlog");
    expect(mine[0].title).toBeTruthy();
  });
});
