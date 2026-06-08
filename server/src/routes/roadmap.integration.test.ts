import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { buildApp } from "../app";
import type { RoadmapItem } from "@vibe-kanban/shared";

let app: Awaited<ReturnType<typeof buildApp>>;
let projectId: string;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  const res = await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: { "Content-Type": "application/json" },
    payload: { name: `Roadmap Test ${Date.now()}`, path: `/tmp/roadmap-test-${Date.now()}` },
  });
  projectId = res.json().id;
});

afterAll(async () => {
  if (projectId) {
    await app.inject({ method: "DELETE", url: `/api/projects/${projectId}` });
  }
});

describe("Roadmap API", () => {
  let itemId: string;

  test("POST /api/projects/:id/roadmap — create item", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/roadmap`,
      headers: { "Content-Type": "application/json" },
      payload: {
        title: "Phase 1: MVP",
        description: "Build the minimum viable product",
        status: "planned",
        startDate: "2026-04-15",
        endDate: "2026-05-15",
        color: "#3b82f6",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.title).toBe("Phase 1: MVP");
    expect(body.status).toBe("planned");
    expect(body.startDate).toBe("2026-04-15");
    expect(body.endDate).toBe("2026-05-15");
    expect(body.dependsOn).toEqual([]);
    expect(body.sortOrder).toBeGreaterThan(0);
    itemId = body.id;
  });

  test("POST — create with dependencies", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/roadmap`,
      headers: { "Content-Type": "application/json" },
      payload: {
        title: "Phase 2: Beta",
        status: "planned",
        dependsOn: [itemId],
        startDate: "2026-05-16",
        endDate: "2026-06-15",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().dependsOn).toEqual([itemId]);
  });

  test("GET /api/projects/:id/roadmap — list items", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/roadmap`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toBeInstanceOf(Array);
    expect(body.length).toBe(2);
    expect(body[0].title).toBe("Phase 1: MVP");
  });

  test("PATCH /roadmap/:id — update item", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/roadmap/${itemId}`,
      headers: { "Content-Type": "application/json" },
      payload: {
        title: "Phase 1: Core MVP",
        status: "in_progress",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.title).toBe("Phase 1: Core MVP");
    expect(body.status).toBe("in_progress");
  });

  test("PATCH — 404 for non-existent item", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/roadmap/nonexistent",
      headers: { "Content-Type": "application/json" },
      payload: { title: "nope" },
    });
    expect(res.statusCode).toBe(404);
  });

  test("DELETE /roadmap/:id — delete item", async () => {
    // Create then delete
    const createRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/roadmap`,
      headers: { "Content-Type": "application/json" },
      payload: { title: "To Delete" },
    });
    const delId = createRes.json().id;

    const res = await app.inject({
      method: "DELETE",
      url: `/api/roadmap/${delId}`,
    });
    expect(res.statusCode).toBe(204);

    // Verify list doesn't include it
    const listRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/roadmap`,
    });
    const ids = (listRes.json() as RoadmapItem[]).map((i) => i.id);
    expect(ids).not.toContain(delId);
  });

  test("DELETE — 404 for non-existent item", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/roadmap/nonexistent",
    });
    expect(res.statusCode).toBe(404);
  });

  test("items cascade delete with project", async () => {
    const projRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { "Content-Type": "application/json" },
      payload: {
        name: `Cascade Roadmap ${Date.now()}`,
        path: `/tmp/cascade-roadmap-${Date.now()}`,
      },
    });
    const tempId = projRes.json().id;

    await app.inject({
      method: "POST",
      url: `/api/projects/${tempId}/roadmap`,
      headers: { "Content-Type": "application/json" },
      payload: { title: "Temp Phase" },
    });

    await app.inject({ method: "DELETE", url: `/api/projects/${tempId}` });

    const listRes = await app.inject({
      method: "GET",
      url: `/api/projects/${tempId}/roadmap`,
    });
    expect(listRes.json().length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// O4: milestone/task linkage + rollup
// ---------------------------------------------------------------------------

describe("Roadmap milestone/task linkage + rollup", () => {
  let projectId: string;
  let otherProjectId: string;

  async function createProject(name: string): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { "Content-Type": "application/json" },
      payload: {
        name: `${name} ${Date.now()}-${Math.random()}`,
        path: `/tmp/${name}-${Date.now()}-${Math.random()}`,
      },
    });
    return res.json().id;
  }

  async function createMilestone(pid: string, name: string): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${pid}/milestones`,
      headers: { "Content-Type": "application/json" },
      payload: { name },
    });
    return res.json().id;
  }

  async function createTask(
    pid: string,
    title: string,
    status: string,
    milestoneId?: string,
  ): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${pid}/tasks`,
      headers: { "Content-Type": "application/json" },
      payload: { title, status, milestoneId },
    });
    return res.json().id;
  }

  async function getItem(pid: string, itemId: string): Promise<RoadmapItem> {
    const res = await app.inject({ method: "GET", url: `/api/projects/${pid}/roadmap` });
    const found = (res.json() as RoadmapItem[]).find((i) => i.id === itemId);
    if (!found) throw new Error(`Roadmap item ${itemId} not found`);
    return found;
  }

  beforeAll(async () => {
    projectId = await createProject("o4-roadmap");
    otherProjectId = await createProject("o4-roadmap-other");
  });

  afterAll(async () => {
    if (projectId) await app.inject({ method: "DELETE", url: `/api/projects/${projectId}` });
    if (otherProjectId)
      await app.inject({ method: "DELETE", url: `/api/projects/${otherProjectId}` });
  });

  test("(a) rollup over milestone with MIXED task statuses", async () => {
    const milestoneId = await createMilestone(projectId, "MVP");
    // 4 tasks under the milestone: done, approved, todo, in_progress -> 2 done of 4
    await createTask(projectId, "T-done", "done", milestoneId);
    await createTask(projectId, "T-approved", "approved", milestoneId);
    await createTask(projectId, "T-todo", "todo", milestoneId);
    await createTask(projectId, "T-inprogress", "in_progress", milestoneId);

    // Two of those tasks are also directly linked to the roadmap item
    const linkedDone = await createTask(projectId, "Link-done", "done");
    const linkedTodo = await createTask(projectId, "Link-todo", "todo");

    const createRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/roadmap`,
      headers: { "Content-Type": "application/json" },
      payload: {
        title: "Linked Phase",
        milestoneId,
        taskIds: [linkedDone, linkedTodo],
      },
    });
    expect(createRes.statusCode).toBe(200);
    const created = createRes.json();
    expect(created.milestoneId).toBe(milestoneId);
    expect(created.taskIds.sort()).toEqual([linkedDone, linkedTodo].sort());
    // Rollups on the create response itself
    expect(created.tasksTotal).toBe(2);
    expect(created.tasksDone).toBe(1);
    expect(created.milestoneTasksTotal).toBe(4);
    expect(created.milestoneTasksDone).toBe(2);

    // Rollups on the GET /roadmap list
    const fromList = await getItem(projectId, created.id);
    expect(fromList.tasksTotal).toBe(2);
    expect(fromList.tasksDone).toBe(1);
    expect(fromList.milestoneTasksTotal).toBe(4);
    expect(fromList.milestoneTasksDone).toBe(2);
    expect(fromList.taskIds.sort()).toEqual([linkedDone, linkedTodo].sort());
  });

  test("(b) 400 for unknown and cross-project milestoneId (create + patch)", async () => {
    const crossMilestone = await createMilestone(otherProjectId, "Other MS");

    const unknownRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/roadmap`,
      headers: { "Content-Type": "application/json" },
      payload: { title: "Bad MS", milestoneId: "does-not-exist" },
    });
    expect(unknownRes.statusCode).toBe(400);

    const crossRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/roadmap`,
      headers: { "Content-Type": "application/json" },
      payload: { title: "Cross MS", milestoneId: crossMilestone },
    });
    expect(crossRes.statusCode).toBe(400);

    // PATCH path too
    const ok = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/roadmap`,
      headers: { "Content-Type": "application/json" },
      payload: { title: "Patch target" },
    });
    const patchUnknown = await app.inject({
      method: "PATCH",
      url: `/api/roadmap/${ok.json().id}`,
      headers: { "Content-Type": "application/json" },
      payload: { milestoneId: "nope" },
    });
    expect(patchUnknown.statusCode).toBe(400);
    const patchCross = await app.inject({
      method: "PATCH",
      url: `/api/roadmap/${ok.json().id}`,
      headers: { "Content-Type": "application/json" },
      payload: { milestoneId: crossMilestone },
    });
    expect(patchCross.statusCode).toBe(400);
  });

  test("(b) 400 for unknown and cross-project taskId (create + patch)", async () => {
    const crossTask = await createTask(otherProjectId, "Other task", "todo");

    const unknownRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/roadmap`,
      headers: { "Content-Type": "application/json" },
      payload: { title: "Bad task", taskIds: ["nope-task"] },
    });
    expect(unknownRes.statusCode).toBe(400);

    const crossRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/roadmap`,
      headers: { "Content-Type": "application/json" },
      payload: { title: "Cross task", taskIds: [crossTask] },
    });
    expect(crossRes.statusCode).toBe(400);

    const ok = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/roadmap`,
      headers: { "Content-Type": "application/json" },
      payload: { title: "Patch task target" },
    });
    const patchCross = await app.inject({
      method: "PATCH",
      url: `/api/roadmap/${ok.json().id}`,
      headers: { "Content-Type": "application/json" },
      payload: { taskIds: [crossTask] },
    });
    expect(patchCross.statusCode).toBe(400);
  });

  test("(c) deleting linked milestone leaves item with milestoneId = null, no 500", async () => {
    const milestoneId = await createMilestone(projectId, "Doomed MS");
    await createTask(projectId, "MS task", "done", milestoneId);

    const createRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/roadmap`,
      headers: { "Content-Type": "application/json" },
      payload: { title: "Has milestone", milestoneId },
    });
    const itemId = createRes.json().id;

    const delRes = await app.inject({ method: "DELETE", url: `/api/milestones/${milestoneId}` });
    expect(delRes.statusCode).toBe(204);

    const listRes = await app.inject({ method: "GET", url: `/api/projects/${projectId}/roadmap` });
    expect(listRes.statusCode).toBe(200);
    const item = (listRes.json() as RoadmapItem[]).find((i) => i.id === itemId);
    expect(item).toBeDefined();
    expect(item!.milestoneId).toBeNull();
    expect(item!.milestoneTasksTotal).toBeNull();
    expect(item!.milestoneTasksDone).toBeNull();
  });

  test("(d) deleting a linked task removes the join row, rollup still 200/valid", async () => {
    const t1 = await createTask(projectId, "Del-1", "done");
    const t2 = await createTask(projectId, "Del-2", "todo");

    const createRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/roadmap`,
      headers: { "Content-Type": "application/json" },
      payload: { title: "Task-linked", taskIds: [t1, t2] },
    });
    const itemId = createRes.json().id;
    expect(createRes.json().tasksTotal).toBe(2);
    expect(createRes.json().tasksDone).toBe(1);

    const delTask = await app.inject({ method: "DELETE", url: `/api/tasks/${t1}` });
    expect(delTask.statusCode).toBeLessThan(300);

    const listRes = await app.inject({ method: "GET", url: `/api/projects/${projectId}/roadmap` });
    expect(listRes.statusCode).toBe(200);
    const item = (listRes.json() as RoadmapItem[]).find((i) => i.id === itemId);
    expect(item).toBeDefined();
    // The join row for t1 is gone via CASCADE; only t2 remains (not done).
    expect(item!.taskIds).toEqual([t2]);
    expect(item!.tasksTotal).toBe(1);
    expect(item!.tasksDone).toBe(0);
  });

  test("PATCH replaces task links", async () => {
    const a = await createTask(projectId, "Repl-A", "done");
    const b = await createTask(projectId, "Repl-B", "todo");
    const c = await createTask(projectId, "Repl-C", "approved");

    const createRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/roadmap`,
      headers: { "Content-Type": "application/json" },
      payload: { title: "Replace links", taskIds: [a, b] },
    });
    const itemId = createRes.json().id;

    const patchRes = await app.inject({
      method: "PATCH",
      url: `/api/roadmap/${itemId}`,
      headers: { "Content-Type": "application/json" },
      payload: { taskIds: [c] },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().taskIds).toEqual([c]);
    expect(patchRes.json().tasksTotal).toBe(1);
    expect(patchRes.json().tasksDone).toBe(1); // approved counts as done
  });
});
