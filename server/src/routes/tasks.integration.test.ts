import { describe, test, expect, beforeAll, afterAll, afterEach, mock } from "bun:test";
import { buildApp } from "../app";
import {
  writeFile as realWriteFile,
  spawnProcess as realSpawnProcess,
  isBun as realIsBun,
} from "../lib/runtime";

let app: Awaited<ReturnType<typeof buildApp>>;
let projectId: string;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  // Create a test project
  const res = await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: { "Content-Type": "application/json" },
    payload: { name: "Test Project", path: `/tmp/test-tasks-${Date.now()}` },
  });
  projectId = res.json().id;
});

afterAll(async () => {
  await app.inject({ method: "DELETE", url: `/api/projects/${projectId}` });
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
async function createTask(overrides: Record<string, unknown> = {}) {
  const payload = {
    title: `Task ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    description: "Integration test task",
    priority: "medium",
    status: "backlog",
    ...overrides,
  };
  const res = await app.inject({
    method: "POST",
    url: `/api/projects/${projectId}/tasks`,
    headers: { "Content-Type": "application/json" },
    payload,
  });
  return res.json();
}

// ===========================================================================
// CRUD
// ===========================================================================

describe("Task CRUD", () => {
  test("POST /api/projects/:projectId/tasks - create a task", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/tasks`,
      headers: { "Content-Type": "application/json" },
      payload: {
        title: "My New Task",
        description: "Some description",
        priority: "high",
        status: "todo",
      },
    });

    expect(res.statusCode).toBe(200);
    const task = res.json();
    expect(task.id).toBeDefined();
    expect(task.title).toBe("My New Task");
    expect(task.description).toBe("Some description");
    expect(task.priority).toBe("high");
    expect(task.status).toBe("todo");
    expect(task.projectId).toBe(projectId);
    expect(task.taskNumber).toBeGreaterThan(0);
    expect(task.createdAt).toBeDefined();
    expect(task.updatedAt).toBeDefined();
  });

  test("POST + PATCH /api/tasks - per-task agent persists and clears", async () => {
    // create with agent set
    const created = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/tasks`,
      headers: { "Content-Type": "application/json" },
      payload: { title: "Grok task", agent: "grok" },
    });
    expect(created.statusCode).toBe(200);
    const task = created.json();
    expect(task.agent).toBe("grok");

    // GET reflects it
    const got = await app.inject({ method: "GET", url: `/api/tasks/${task.id}` });
    expect(got.json().agent).toBe("grok");

    // PATCH clears it back to inherit (null)
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.id}`,
      headers: { "Content-Type": "application/json" },
      payload: { agent: null },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().agent).toBeNull();
  });

  test("POST /api/projects/:projectId/tasks - defaults agent to null (inherit)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/tasks`,
      headers: { "Content-Type": "application/json" },
      payload: { title: "No agent task" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().agent).toBeNull();
  });

  test("POST /api/projects/:projectId/tasks - defaults status to backlog and priority to medium", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/tasks`,
      headers: { "Content-Type": "application/json" },
      payload: { title: "Minimal Task" },
    });

    expect(res.statusCode).toBe(200);
    const task = res.json();
    expect(task.status).toBe("backlog");
    expect(task.priority).toBe("medium");
  });

  test("GET /api/projects/:projectId/tasks - list tasks with pagination shape", async () => {
    // Ensure at least one task exists
    await createTask();

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/tasks`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(typeof body.total).toBe("number");
    expect(typeof body.hasMore).toBe("boolean");
    expect(body.total).toBeGreaterThanOrEqual(1);
  });

  test("GET /api/tasks/:id - get single task", async () => {
    const task = await createTask({ title: "Single Fetch Task" });

    const res = await app.inject({
      method: "GET",
      url: `/api/tasks/${task.id}`,
    });

    expect(res.statusCode).toBe(200);
    const fetched = res.json();
    expect(fetched.id).toBe(task.id);
    expect(fetched.title).toBe("Single Fetch Task");
  });

  test("GET /api/tasks/:id - returns 404 for non-existent task", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/tasks/non-existent-id",
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Task not found");
  });

  test("PATCH /api/tasks/:id - update task title, status, priority", async () => {
    const task = await createTask({ title: "Before Update" });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.id}`,
      headers: { "Content-Type": "application/json" },
      payload: { title: "After Update", priority: "urgent" },
    });

    expect(res.statusCode).toBe(200);
    const updated = res.json();
    expect(updated.title).toBe("After Update");
    expect(updated.priority).toBe("urgent");
  });

  test("PATCH /api/tasks/:id - returns 404 for non-existent task", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/tasks/non-existent-id",
      headers: { "Content-Type": "application/json" },
      payload: { title: "Nope" },
    });

    expect(res.statusCode).toBe(404);
  });

  test("DELETE /api/tasks/:id - delete task", async () => {
    const task = await createTask({ title: "To Delete" });

    const delRes = await app.inject({
      method: "DELETE",
      url: `/api/tasks/${task.id}`,
    });
    expect(delRes.statusCode).toBe(204);

    // Verify it's gone
    const getRes = await app.inject({
      method: "GET",
      url: `/api/tasks/${task.id}`,
    });
    expect(getRes.statusCode).toBe(404);
  });

  test("DELETE /api/tasks/:id - returns 404 for non-existent task", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/tasks/non-existent-id",
    });
    expect(res.statusCode).toBe(404);
  });
});

// ===========================================================================
// Query / Filter
// ===========================================================================

describe("Task query and filtering", () => {
  let _todoTaskId: string;
  let _inProgressTaskId: string;
  let _highPriorityTaskId: string;
  let searchableTaskId: string;

  beforeAll(async () => {
    // Create tasks with specific attributes for filtering
    const todoTask = await createTask({
      title: "Filter Todo Task",
      status: "todo",
      priority: "low",
    });
    _todoTaskId = todoTask.id;

    const ipTask = await createTask({
      title: "Filter InProgress Task",
      status: "in_progress",
      priority: "high",
    });
    _inProgressTaskId = ipTask.id;

    const highTask = await createTask({
      title: "Filter High Priority",
      status: "backlog",
      priority: "urgent",
    });
    _highPriorityTaskId = highTask.id;

    const searchTask = await createTask({
      title: "UniqueKeyword XyzzyPlugh",
      description: "searchable content",
    });
    searchableTaskId = searchTask.id;
  });

  test("GET /api/projects/:projectId/tasks?status=todo - filter by status", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/tasks?status=todo`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    for (const item of body.items) {
      expect(item.status).toBe("todo");
    }
  });

  test("GET /api/projects/:projectId/tasks?status=in_progress - filter by in_progress", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/tasks?status=in_progress`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    for (const item of body.items) {
      expect(item.status).toBe("in_progress");
    }
  });

  test("GET /api/projects/:projectId/tasks?sort=priority - sort by priority", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/tasks?sort=priority`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const priorityOrder: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
    for (let i = 1; i < body.items.length; i++) {
      const prev = priorityOrder[body.items[i - 1].priority] ?? 99;
      const curr = priorityOrder[body.items[i].priority] ?? 99;
      expect(prev).toBeLessThanOrEqual(curr);
    }
  });

  test("GET /api/projects/:projectId/tasks?search=keyword - search tasks", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/tasks?search=UniqueKeyword`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    const found = body.items.find((t: any) => t.id === searchableTaskId);
    expect(found).toBeDefined();
  });

  test("GET /api/tasks/all - list tasks across projects", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/tasks/all",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(typeof body.total).toBe("number");
    expect(body.total).toBeGreaterThanOrEqual(1);
    // Each item should include projectName from the JOIN
    if (body.items.length > 0) {
      expect(body.items[0].projectName).toBeDefined();
    }
  });

  test("GET /api/tasks/all?status=todo - filter all tasks by status", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/tasks/all?status=todo",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    for (const item of body.items) {
      expect(item.status).toBe("todo");
    }
  });

  test("GET /api/tasks/search?q=keyword - global search", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/tasks/search?q=UniqueKeyword",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
    const found = body.find((t: any) => t.id === searchableTaskId);
    expect(found).toBeDefined();
    expect(found.projectName).toBeDefined();
  });

  test("GET /api/tasks/search - returns empty array when no query", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/tasks/search",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  test("GET /api/projects/:projectId/tasks with limit and offset - pagination", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/tasks?limit=2&offset=0`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.length).toBeLessThanOrEqual(2);
    // total should reflect all tasks, not just the page
    expect(body.total).toBeGreaterThanOrEqual(body.items.length);
  });
});

// ===========================================================================
// Status transition and timestamp cascade
// ===========================================================================

describe("Status transitions and timestamp cascade", () => {
  test("task created as todo gets inboxAt set", async () => {
    const task = await createTask({ status: "todo" });

    expect(task.status).toBe("todo");
    expect(task.inboxAt).not.toBeNull();
    expect(task.inProgressAt).toBeNull();
    expect(task.doneAt).toBeNull();
  });

  test("task created as backlog gets inboxAt set", async () => {
    const task = await createTask({ status: "backlog" });

    expect(task.status).toBe("backlog");
    expect(task.inboxAt).not.toBeNull();
    expect(task.inProgressAt).toBeNull();
    expect(task.doneAt).toBeNull();
  });

  test("task created as in_progress gets inboxAt and inProgressAt set", async () => {
    const task = await createTask({ status: "in_progress" });

    expect(task.status).toBe("in_progress");
    expect(task.inboxAt).not.toBeNull();
    expect(task.inProgressAt).not.toBeNull();
    expect(task.doneAt).toBeNull();
  });

  test("task created as done gets inboxAt, inProgressAt, and doneAt set", async () => {
    const task = await createTask({ status: "done" });

    expect(task.status).toBe("done");
    expect(task.inboxAt).not.toBeNull();
    expect(task.inProgressAt).not.toBeNull();
    expect(task.doneAt).not.toBeNull();
  });

  test("transition from todo to in_progress sets inProgressAt", async () => {
    const task = await createTask({ status: "todo" });
    expect(task.inProgressAt).toBeNull();

    const res = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.id}`,
      headers: { "Content-Type": "application/json" },
      payload: { status: "in_progress" },
    });

    expect(res.statusCode).toBe(200);
    const updated = res.json();
    expect(updated.status).toBe("in_progress");
    expect(updated.inProgressAt).not.toBeNull();
    // inboxAt was already set at creation
    expect(updated.inboxAt).not.toBeNull();
  });

  test("transition from in_progress to done sets doneAt", async () => {
    const task = await createTask({ status: "in_progress" });
    expect(task.doneAt).toBeNull();

    const res = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.id}`,
      headers: { "Content-Type": "application/json" },
      payload: { status: "done" },
    });

    expect(res.statusCode).toBe(200);
    const updated = res.json();
    expect(updated.status).toBe("done");
    expect(updated.doneAt).not.toBeNull();
    expect(updated.inProgressAt).not.toBeNull();
    expect(updated.inboxAt).not.toBeNull();
  });

  test("transition from backlog directly to done sets all timestamps", async () => {
    const task = await createTask({ status: "backlog" });
    const originalInboxAt = task.inboxAt;

    const res = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.id}`,
      headers: { "Content-Type": "application/json" },
      payload: { status: "done" },
    });

    expect(res.statusCode).toBe(200);
    const updated = res.json();
    expect(updated.status).toBe("done");
    expect(updated.inboxAt).not.toBeNull();
    expect(updated.inProgressAt).not.toBeNull();
    expect(updated.doneAt).not.toBeNull();
    // inboxAt was already set at creation, so it should be preserved
    expect(updated.inboxAt).toBe(originalInboxAt);
  });

  test("transition to approved sets approvedAt and all prior timestamps", async () => {
    const task = await createTask({ status: "todo" });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.id}`,
      headers: { "Content-Type": "application/json" },
      payload: { status: "approved" },
    });

    expect(res.statusCode).toBe(200);
    const updated = res.json();
    expect(updated.status).toBe("approved");
    expect(updated.inboxAt).not.toBeNull();
    expect(updated.inProgressAt).not.toBeNull();
    expect(updated.doneAt).not.toBeNull();
    expect(updated.approvedAt).not.toBeNull();
  });

  test("transition to archived sets archivedAt and all prior timestamps", async () => {
    const task = await createTask({ status: "todo" });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.id}`,
      headers: { "Content-Type": "application/json" },
      payload: { status: "archived" },
    });

    expect(res.statusCode).toBe(200);
    const updated = res.json();
    expect(updated.status).toBe("archived");
    expect(updated.inboxAt).not.toBeNull();
    expect(updated.inProgressAt).not.toBeNull();
    expect(updated.doneAt).not.toBeNull();
    expect(updated.approvedAt).not.toBeNull();
    expect(updated.archivedAt).not.toBeNull();
  });

  test("timestamps are not overwritten on subsequent transitions", async () => {
    // Create as todo (sets inboxAt)
    const task = await createTask({ status: "todo" });
    const originalInboxAt = task.inboxAt;

    // Move to in_progress (sets inProgressAt, keeps inboxAt)
    const ipRes = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.id}`,
      headers: { "Content-Type": "application/json" },
      payload: { status: "in_progress" },
    });
    const ipTask = ipRes.json();
    expect(ipTask.inboxAt).toBe(originalInboxAt);
    const originalInProgressAt = ipTask.inProgressAt;

    // Move to done (sets doneAt, keeps inboxAt and inProgressAt)
    const doneRes = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.id}`,
      headers: { "Content-Type": "application/json" },
      payload: { status: "done" },
    });
    const doneTask = doneRes.json();
    expect(doneTask.inboxAt).toBe(originalInboxAt);
    expect(doneTask.inProgressAt).toBe(originalInProgressAt);
    expect(doneTask.doneAt).not.toBeNull();
  });

  test("full lifecycle: backlog -> todo -> in_progress -> done -> approved -> archived", async () => {
    const task = await createTask({ status: "backlog" });

    // -> todo
    let res = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.id}`,
      headers: { "Content-Type": "application/json" },
      payload: { status: "todo" },
    });
    let updated = res.json();
    expect(updated.status).toBe("todo");
    expect(updated.inboxAt).not.toBeNull();

    // -> in_progress
    res = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.id}`,
      headers: { "Content-Type": "application/json" },
      payload: { status: "in_progress" },
    });
    updated = res.json();
    expect(updated.status).toBe("in_progress");
    expect(updated.inProgressAt).not.toBeNull();

    // -> done
    res = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.id}`,
      headers: { "Content-Type": "application/json" },
      payload: { status: "done" },
    });
    updated = res.json();
    expect(updated.status).toBe("done");
    expect(updated.doneAt).not.toBeNull();

    // -> approved
    res = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.id}`,
      headers: { "Content-Type": "application/json" },
      payload: { status: "approved" },
    });
    updated = res.json();
    expect(updated.status).toBe("approved");
    expect(updated.approvedAt).not.toBeNull();

    // -> archived
    res = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.id}`,
      headers: { "Content-Type": "application/json" },
      payload: { status: "archived" },
    });
    updated = res.json();
    expect(updated.status).toBe("archived");
    expect(updated.archivedAt).not.toBeNull();
  });
});

// ===========================================================================
// Working on / reorder / misc
// ===========================================================================

describe("Additional task endpoints", () => {
  test("GET /api/tasks/working-on - returns in_progress tasks", async () => {
    const task = await createTask({ status: "in_progress", title: "Working On This" });

    const res = await app.inject({
      method: "GET",
      url: "/api/tasks/working-on",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    const found = body.find((t: any) => t.id === task.id);
    expect(found).toBeDefined();
    expect(found.projectName).toBeDefined();
  });

  test("PATCH /api/tasks/reorder - reorder tasks", async () => {
    const task1 = await createTask({ title: "Reorder A" });
    const task2 = await createTask({ title: "Reorder B" });

    const res = await app.inject({
      method: "PATCH",
      url: "/api/tasks/reorder",
      headers: { "Content-Type": "application/json" },
      payload: {
        tasks: [
          { id: task1.id, sortOrder: 10 },
          { id: task2.id, sortOrder: 20 },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);

    // Verify the sort orders were applied
    const get1 = await app.inject({ method: "GET", url: `/api/tasks/${task1.id}` });
    const get2 = await app.inject({ method: "GET", url: `/api/tasks/${task2.id}` });
    expect(get1.json().sortOrder).toBe(10);
    expect(get2.json().sortOrder).toBe(20);
  });

  test("PATCH /api/tasks/reorder - reorder with status change applies cascade", async () => {
    const task = await createTask({ status: "backlog", title: "Reorder Status" });
    expect(task.inProgressAt).toBeNull();

    const res = await app.inject({
      method: "PATCH",
      url: "/api/tasks/reorder",
      headers: { "Content-Type": "application/json" },
      payload: {
        tasks: [{ id: task.id, sortOrder: 5, status: "in_progress" }],
      },
    });

    expect(res.statusCode).toBe(200);
    const updated = await app.inject({ method: "GET", url: `/api/tasks/${task.id}` });
    const updatedTask = updated.json();
    expect(updatedTask.status).toBe("in_progress");
    expect(updatedTask.inProgressAt).not.toBeNull();
  });

  test("POST /api/projects/:projectId/tasks/bulk-import - bulk import tasks", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/tasks/bulk-import`,
      headers: { "Content-Type": "application/json" },
      payload: {
        tasks: [
          { title: "Bulk Task 1", priority: "high" },
          { title: "Bulk Task 2", priority: "low", status: "todo" },
          { title: "Bulk Task 3" },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const created = res.json();
    expect(Array.isArray(created)).toBe(true);
    expect(created.length).toBe(3);
    expect(created[0].title).toBe("Bulk Task 1");
    expect(created[0].priority).toBe("high");
    expect(created[1].status).toBe("todo");
    expect(created[1].inboxAt).not.toBeNull(); // cascade for todo
    expect(created[2].priority).toBe("medium"); // default
    // Each task should have a unique taskNumber
    const numbers = created.map((t: any) => t.taskNumber);
    expect(new Set(numbers).size).toBe(3);
  });

  test("POST /api/projects/:projectId/tasks/archive-approved - archive approved tasks", async () => {
    // Create two approved tasks
    const t1 = await createTask({ status: "approved", title: "Approved A" });
    const t2 = await createTask({ status: "approved", title: "Approved B" });

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/tasks/archive-approved`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.archived).toBeGreaterThanOrEqual(2);

    // Verify tasks are now archived
    const get1 = await app.inject({ method: "GET", url: `/api/tasks/${t1.id}` });
    const get2 = await app.inject({ method: "GET", url: `/api/tasks/${t2.id}` });
    expect(get1.json().status).toBe("archived");
    expect(get2.json().status).toBe("archived");
    expect(get1.json().archivedAt).not.toBeNull();
    expect(get2.json().archivedAt).not.toBeNull();
  });

  test("POST /api/projects/:projectId/tasks/archive-approved - returns 0 when none approved", async () => {
    // Create a fresh project with no approved tasks to ensure clean state
    const projRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { "Content-Type": "application/json" },
      payload: { name: "Empty Project", path: `/tmp/test-empty-${Date.now()}` },
    });
    const emptyProjectId = projRes.json().id;

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${emptyProjectId}/tasks/archive-approved`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().archived).toBe(0);

    // Cleanup
    await app.inject({ method: "DELETE", url: `/api/projects/${emptyProjectId}` });
  });

  test("task numbers increment per project", async () => {
    // Create a fresh project to ensure clean numbering
    const projRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { "Content-Type": "application/json" },
      payload: { name: "Numbering Project", path: `/tmp/test-numbering-${Date.now()}` },
    });
    const numbProjId = projRes.json().id;

    const t1Res = await app.inject({
      method: "POST",
      url: `/api/projects/${numbProjId}/tasks`,
      headers: { "Content-Type": "application/json" },
      payload: { title: "First" },
    });
    const t2Res = await app.inject({
      method: "POST",
      url: `/api/projects/${numbProjId}/tasks`,
      headers: { "Content-Type": "application/json" },
      payload: { title: "Second" },
    });
    const t3Res = await app.inject({
      method: "POST",
      url: `/api/projects/${numbProjId}/tasks`,
      headers: { "Content-Type": "application/json" },
      payload: { title: "Third" },
    });

    expect(t1Res.json().taskNumber).toBe(1);
    expect(t2Res.json().taskNumber).toBe(2);
    expect(t3Res.json().taskNumber).toBe(3);

    // Cleanup
    await app.inject({ method: "DELETE", url: `/api/projects/${numbProjId}` });
  });

  test("PATCH /api/tasks/:id - update description and prompt", async () => {
    const task = await createTask({ title: "Update Fields" });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.id}`,
      headers: { "Content-Type": "application/json" },
      payload: { description: "Updated description", prompt: "Do the thing" },
    });

    expect(res.statusCode).toBe(200);
    const updated = res.json();
    expect(updated.description).toBe("Updated description");
    // prompt is an updatable field only if included in the allowed list
    // Check the route: "prompt" is in the allowed keys
    expect(updated.prompt).toBe("Do the thing");
  });

  test("PATCH /api/tasks/:id - update milestoneId", async () => {
    const task = await createTask({ title: "Milestone Task" });

    // Create a milestone for the test
    const msRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/milestones`,
      headers: { "Content-Type": "application/json" },
      payload: { name: "Test Milestone" },
    });
    const milestoneId = msRes.json().id;

    const res = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.id}`,
      headers: { "Content-Type": "application/json" },
      payload: { milestoneId },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().milestoneId).toBe(milestoneId);

    // Clear milestone
    const clearRes = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.id}`,
      headers: { "Content-Type": "application/json" },
      payload: { milestoneId: null },
    });
    expect(clearRes.json().milestoneId).toBeNull();
  });

  test("updatedAt changes on PATCH", async () => {
    const task = await createTask({ title: "Check UpdatedAt" });
    const originalUpdatedAt = task.updatedAt;

    // Small delay to ensure different timestamp
    await new Promise((resolve) => setTimeout(resolve, 10));

    const res = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.id}`,
      headers: { "Content-Type": "application/json" },
      payload: { title: "Changed Title" },
    });

    const updated = res.json();
    expect(updated.updatedAt).not.toBe(originalUpdatedAt);
  });

  test("PATCH /api/tasks/:id - empty update body returns existing task unchanged", async () => {
    const task = await createTask({ title: "No Change Task" });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.id}`,
      headers: { "Content-Type": "application/json" },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    const returned = res.json();
    expect(returned.id).toBe(task.id);
    expect(returned.title).toBe("No Change Task");
  });

  test("POST /api/projects/:projectId/tasks - create task with parentTaskId (subtask)", async () => {
    const parent = await createTask({ title: "Parent Task" });

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/tasks`,
      headers: { "Content-Type": "application/json" },
      payload: { title: "Subtask", parentTaskId: parent.id },
    });

    expect(res.statusCode).toBe(200);
    const child = res.json();
    expect(child.parentTaskId).toBe(parent.id);
    expect(child.title).toBe("Subtask");
  });
});

// ===========================================================================
// Sort variations
// ===========================================================================

describe("Task sort variations", () => {
  test("GET /api/projects/:projectId/tasks?sort=newest - sort by newest first", async () => {
    await createTask({ title: "Older Task" });
    await new Promise((r) => setTimeout(r, 10));
    const newer = await createTask({ title: "Newer Task" });

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/tasks?sort=newest`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.length).toBeGreaterThanOrEqual(2);
    // First item should be most recently created
    expect(body.items[0].id).toBe(newer.id);
  });

  test("GET /api/projects/:projectId/tasks?sort=oldest - sort by oldest first", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/tasks?sort=oldest`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    // Items should be ordered oldest first
    for (let i = 1; i < body.items.length; i++) {
      expect(body.items[i - 1].createdAt <= body.items[i].createdAt).toBe(true);
    }
  });

  test("GET /api/projects/:projectId/tasks?sort=updated - sort by updated", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/tasks?sort=updated`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    // Items should be ordered most recently updated first
    for (let i = 1; i < body.items.length; i++) {
      expect(body.items[i - 1].updatedAt >= body.items[i].updatedAt).toBe(true);
    }
  });

  test("GET /api/projects/:projectId/tasks?milestoneId=<id> - filter by specific milestone ID", async () => {
    // Create a milestone
    const msRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/milestones`,
      headers: { "Content-Type": "application/json" },
      payload: { name: "Filter Milestone" },
    });
    const milestoneId = msRes.json().id;

    // Create a task assigned to this milestone
    const withMs = await createTask({ title: "Task With Milestone", milestoneId });
    // Create a task with no milestone
    await createTask({ title: "Task No Milestone" });

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/tasks?milestoneId=${milestoneId}&limit=200`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // All returned items should belong to this milestone
    for (const item of body.items) {
      expect(item.milestoneId).toBe(milestoneId);
    }
    const found = body.items.find((t: any) => t.id === withMs.id);
    expect(found).toBeDefined();
  });

  test("GET /api/projects/:projectId/tasks?milestoneId=null - filter by null milestone", async () => {
    const task = await createTask({ title: "No Milestone Task" });

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/tasks?milestoneId=null&limit=200`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // All returned items should have null milestoneId
    for (const item of body.items) {
      expect(item.milestoneId).toBeNull();
    }
    const found = body.items.find((t: any) => t.id === task.id);
    expect(found).toBeDefined();
  });

  test("GET /api/projects/:projectId/tasks?milestoneId=general - filter by general milestone", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/tasks?milestoneId=general`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // "general" is an alias for null milestoneId
    for (const item of body.items) {
      expect(item.milestoneId).toBeNull();
    }
  });

  test("GET /api/tasks/all?sort=priority - sort all tasks by priority", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/tasks/all?sort=priority",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
  });

  test("GET /api/tasks/all?sort=newest - sort all tasks by newest", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/tasks/all?sort=newest",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
  });

  test("GET /api/tasks/all?sort=oldest - sort all tasks by oldest", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/tasks/all?sort=oldest",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
  });
});

// ===========================================================================
// AI preflight, decompose, ai-resolve, ai-runs, ai-stats
// ===========================================================================

describe("AI preflight endpoint", () => {
  test("GET /api/projects/:projectId/tasks/:taskId/ai-preflight - returns preflight data", async () => {
    const task = await createTask({
      title: "Implement user authentication flow",
      description: "Add login, signup, and password reset pages",
      prompt: "Use bcrypt for hashing, JWT for sessions",
      status: "todo",
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/tasks/${task.id}/ai-preflight`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.taskId).toBe(task.id);
    expect(body.title).toBe("Implement user authentication flow");
    expect(body.detectedProfile).toBeDefined();
    expect(body.effectiveProfile).toBeDefined();
    expect(body.scope).toBeDefined();
    expect(typeof body.hasDescription).toBe("boolean");
    expect(body.hasDescription).toBe(true);
    expect(typeof body.hasPrompt).toBe("boolean");
    expect(body.hasPrompt).toBe(true);
    expect(Array.isArray(body.warnings)).toBe(true);
    expect(body.warnings.length).toBe(0); // has description and prompt, title is long enough
  });

  test("GET /api/projects/:projectId/tasks/:taskId/ai-preflight - returns 404 for non-existent task", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/tasks/non-existent-task/ai-preflight`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Task not found");
  });

  test("GET /api/projects/:projectId/tasks/:taskId/ai-preflight - returns 404 when task belongs to different project", async () => {
    const task = await createTask({ title: "Some Task" });

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/nonexistent-project/tasks/${task.id}/ai-preflight`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Task not found");
  });

  test("GET /api/projects/:projectId/tasks/:taskId/ai-preflight - warns about missing description/prompt", async () => {
    const task = await createTask({ title: "Short", description: "" });

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/tasks/${task.id}/ai-preflight`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.hasDescription).toBe(false);
    expect(body.hasPrompt).toBe(false);
    expect(body.warnings.length).toBeGreaterThanOrEqual(1);
    // Should warn about no description and short title
    expect(body.warnings.some((w: string) => w.includes("no description"))).toBe(true);
    expect(body.warnings.some((w: string) => w.includes("very short"))).toBe(true);
  });

  test("GET /api/projects/:projectId/tasks/:taskId/ai-preflight - detects bug-fix profile", async () => {
    const task = await createTask({
      title: "Fix crash when uploading large files",
      description: "The app crashes with an error when files exceed 10MB",
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/tasks/${task.id}/ai-preflight`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.detectedProfile).toBe("bug-fix");
  });

  test("GET /api/projects/:projectId/tasks/:taskId/ai-preflight - estimates complexity based on content length", async () => {
    // Small task
    const smallTask = await createTask({ title: "Fix typo" });
    const smallRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/tasks/${smallTask.id}/ai-preflight`,
    });
    expect(smallRes.json().scope).toBe("small");

    // Large task
    const longDescription = "A".repeat(500);
    const largeTask = await createTask({
      title: "Major refactor of the entire codebase",
      description: longDescription,
    });
    const largeRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/tasks/${largeTask.id}/ai-preflight`,
    });
    expect(largeRes.json().scope).toBe("large");
  });
});

describe("AI decompose endpoint", () => {
  test("POST /api/projects/:projectId/tasks/:taskId/decompose - returns 404 for non-existent task", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/tasks/non-existent-task/decompose`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Task not found");
  });

  test("POST /api/projects/:projectId/tasks/:taskId/decompose - returns 404 when task belongs to different project", async () => {
    const task = await createTask({ title: "Decompose Test" });

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/nonexistent-project/tasks/${task.id}/decompose`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Task not found");
  });

  test("POST /api/projects/:projectId/tasks/:taskId/decompose - creates subtasks via CLI path", async () => {
    // Mock spawnProcess so the route uses the CLI path and returns a JSON array.
    // Keep realWriteFile so snapshot.ts continues to work.
    const subtaskJson = JSON.stringify([
      { title: "Subtask Alpha", description: "First subtask", priority: "high" },
      { title: "Subtask Beta", description: "Second subtask", priority: "medium" },
    ]);

    mock.module("../lib/runtime", () => ({
      isBun: realIsBun,
      spawnProcess: mock(async (cmd: string[]) => {
        // First call is `which claude` — return exit 0 (CLI available)
        if (cmd[0] === "which" || cmd[0] === "where") {
          return { stdout: "/usr/bin/claude", stderr: "", exitCode: 0 };
        }
        // Second call is the actual claude invocation — return subtask JSON
        return { stdout: subtaskJson, stderr: "", exitCode: 0 };
      }),
      spawnProcessSync: mock(() => ({ stdout: "/usr/bin/claude", exitCode: 0 })),
      writeFile: realWriteFile,
      spawnStreaming: mock(() => ({
        onData: mock(() => {}),
        onStderr: mock(() => {}),
        kill: mock(() => {}),
        exited: Promise.resolve(0),
      })),
      spawnPty: mock(() => ({
        write: mock(() => {}),
        resize: mock(() => {}),
        kill: mock(() => {}),
        onData: mock(() => {}),
        onExit: mock(() => {}),
      })),
    }));

    const parent = await createTask({
      title: "Implement full user authentication system",
      description: "Login, signup, password reset, OAuth integration",
      priority: "high",
      status: "todo",
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/tasks/${parent.id}/decompose`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.parentTaskId).toBe(parent.id);
    expect(Array.isArray(body.subtasks)).toBe(true);
    expect(body.subtasks.length).toBe(2);
    expect(body.subtasks[0].title).toBe("Subtask Alpha");
    expect(body.subtasks[1].title).toBe("Subtask Beta");
    // Subtasks are linked to the parent
    for (const subtask of body.subtasks) {
      expect(subtask.parentTaskId).toBe(parent.id);
      expect(subtask.projectId).toBe(projectId);
      expect(subtask.status).toBe("todo");
    }
  });

  test("POST /api/projects/:projectId/tasks/:taskId/decompose - falls back to API when CLI unavailable", async () => {
    // Insert a fake API key into settings
    const { getDb } = await import("../db");
    const db = getDb();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      "claudeApiKey",
      JSON.stringify("test-api-key"),
    );

    const subtaskJson = JSON.stringify([
      { title: "API Subtask One", description: "via API", priority: "medium" },
    ]);

    // Mock spawnProcess so CLI check fails, triggering the API fallback
    mock.module("../lib/runtime", () => ({
      isBun: realIsBun,
      spawnProcess: mock(async () => {
        // which claude fails — CLI not available
        return { stdout: "", stderr: "not found", exitCode: 1 };
      }),
      spawnProcessSync: mock(() => ({ stdout: "", exitCode: 1 })),
      writeFile: realWriteFile,
      spawnStreaming: mock(() => ({
        onData: mock(() => {}),
        onStderr: mock(() => {}),
        kill: mock(() => {}),
        exited: Promise.resolve(0),
      })),
      spawnPty: mock(() => ({
        write: mock(() => {}),
        resize: mock(() => {}),
        kill: mock(() => {}),
        onData: mock(() => {}),
        onExit: mock(() => {}),
      })),
    }));

    // Mock the global fetch so the Anthropic API call returns our subtask JSON
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (_url: string, _opts: any) => ({
      json: async () => ({
        content: [{ text: subtaskJson }],
      }),
    })) as any;

    const parent = await createTask({
      title: "Refactor database layer",
      description: "Move to an ORM and add migrations",
      priority: "medium",
      status: "todo",
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/tasks/${parent.id}/decompose`,
    });

    // Restore fetch
    globalThis.fetch = originalFetch;

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.parentTaskId).toBe(parent.id);
    expect(Array.isArray(body.subtasks)).toBe(true);
    expect(body.subtasks.length).toBe(1);
    expect(body.subtasks[0].title).toBe("API Subtask One");
    expect(body.subtasks[0].parentTaskId).toBe(parent.id);
  });

  test("POST /api/projects/:projectId/tasks/:taskId/decompose - returns 500 when AI response has no JSON array", async () => {
    mock.module("../lib/runtime", () => ({
      isBun: realIsBun,
      spawnProcess: mock(async (cmd: string[]) => {
        if (cmd[0] === "which" || cmd[0] === "where") {
          return { stdout: "/usr/bin/claude", stderr: "", exitCode: 0 };
        }
        // Return non-JSON response
        return { stdout: "I cannot decompose this task.", stderr: "", exitCode: 0 };
      }),
      spawnProcessSync: mock(() => ({ stdout: "/usr/bin/claude", exitCode: 0 })),
      writeFile: realWriteFile,
      spawnStreaming: mock(() => ({
        onData: mock(() => {}),
        onStderr: mock(() => {}),
        kill: mock(() => {}),
        exited: Promise.resolve(0),
      })),
      spawnPty: mock(() => ({
        write: mock(() => {}),
        resize: mock(() => {}),
        kill: mock(() => {}),
        onData: mock(() => {}),
        onExit: mock(() => {}),
      })),
    }));

    const parent = await createTask({ title: "Task With No JSON Response", status: "todo" });

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/tasks/${parent.id}/decompose`,
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("AI did not return valid subtasks");
  });

  test("POST /api/projects/:projectId/tasks/:taskId/decompose - returns 500 when response contains invalid JSON array", async () => {
    mock.module("../lib/runtime", () => ({
      isBun: realIsBun,
      spawnProcess: mock(async (cmd: string[]) => {
        if (cmd[0] === "which" || cmd[0] === "where") {
          return { stdout: "/usr/bin/claude", stderr: "", exitCode: 0 };
        }
        // Return text that looks like a JSON array (regex matches) but is malformed JSON
        return { stdout: "Here are subtasks: [invalid json content]", stderr: "", exitCode: 0 };
      }),
      spawnProcessSync: mock(() => ({ stdout: "/usr/bin/claude", exitCode: 0 })),
      writeFile: realWriteFile,
      spawnStreaming: mock(() => ({
        onData: mock(() => {}),
        onStderr: mock(() => {}),
        kill: mock(() => {}),
        exited: Promise.resolve(0),
      })),
      spawnPty: mock(() => ({
        write: mock(() => {}),
        resize: mock(() => {}),
        kill: mock(() => {}),
        onData: mock(() => {}),
        onExit: mock(() => {}),
      })),
    }));

    const parent = await createTask({ title: "Task With Malformed JSON", status: "todo" });

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/tasks/${parent.id}/decompose`,
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("Failed to parse AI response as JSON");
  });

  test("POST /api/projects/:projectId/tasks/:taskId/decompose - returns 500 when CLI unavailable and no API key", async () => {
    // Ensure no API key in settings
    const { getDb } = await import("../db");
    const db = getDb();
    db.prepare("DELETE FROM settings WHERE key = 'claudeApiKey'").run();

    mock.module("../lib/runtime", () => ({
      isBun: realIsBun,
      spawnProcess: mock(async () => ({ stdout: "", stderr: "not found", exitCode: 1 })),
      spawnProcessSync: mock(() => ({ stdout: "", exitCode: 1 })),
      writeFile: realWriteFile,
      spawnStreaming: mock(() => ({
        onData: mock(() => {}),
        onStderr: mock(() => {}),
        kill: mock(() => {}),
        exited: Promise.resolve(0),
      })),
      spawnPty: mock(() => ({
        write: mock(() => {}),
        resize: mock(() => {}),
        kill: mock(() => {}),
        onData: mock(() => {}),
        onExit: mock(() => {}),
      })),
    }));

    const parent = await createTask({ title: "Task Without AI Backend", status: "todo" });

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/tasks/${parent.id}/decompose`,
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("No AI backend available");
  });

  afterEach(() => {
    // Restore the real runtime module after each test that may have mocked it
    mock.module("../lib/runtime", () => ({
      isBun: realIsBun,
      spawnProcess: realSpawnProcess,
      writeFile: realWriteFile,
    }));
  });
});

describe("AI resolve endpoint", () => {
  test("POST /api/projects/:projectId/tasks/:taskId/ai-resolve - returns 404 for non-existent task", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/tasks/non-existent-task/ai-resolve`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Task not found");
  });

  test("POST /api/projects/:projectId/tasks/:taskId/ai-resolve - returns 404 when task belongs to different project", async () => {
    const task = await createTask({ title: "Resolve Test" });

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/nonexistent-project/tasks/${task.id}/ai-resolve`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Task not found");
  });

  test("POST /api/projects/:projectId/tasks/:taskId/ai-resolve - returns prompt string for existing task", async () => {
    const task = await createTask({
      title: "Add dark mode support to the UI",
      description:
        "Implement a toggle that switches between light and dark themes using CSS variables",
      prompt: "Use Tailwind CSS dark: prefix classes",
      status: "todo",
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/tasks/${task.id}/ai-resolve`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.prompt).toBe("string");
    expect(body.prompt.length).toBeGreaterThan(0);
    // The prompt should reference the task title somewhere
    expect(body.prompt).toContain("dark mode");
  });
});

// ===========================================================================
// AI Runs endpoints
// ===========================================================================

describe("AI runs endpoints", () => {
  test("POST /api/tasks/:taskId/ai-runs - record an AI run", async () => {
    const task = await createTask({ title: "AI Run Task" });

    const res = await app.inject({
      method: "POST",
      url: `/api/tasks/${task.id}/ai-runs`,
      headers: { "Content-Type": "application/json" },
      payload: {
        profile: "feature",
        complexity: "medium",
        exitCode: 0,
        success: true,
        filesChanged: 3,
        durationMs: 15000,
        summary: "Successfully implemented feature",
      },
    });

    expect(res.statusCode).toBe(200);
    const run = res.json();
    expect(run.id).toBeDefined();
    expect(run.taskId).toBe(task.id);
    expect(run.projectId).toBe(projectId);
    expect(run.profile).toBe("feature");
    expect(run.complexity).toBe("medium");
    expect(run.exitCode).toBe(0);
    expect(run.success).toBe(1);
    expect(run.filesChanged).toBe(3);
    expect(run.durationMs).toBe(15000);
    expect(run.summary).toBe("Successfully implemented feature");
  });

  test("POST /api/tasks/:taskId/ai-runs - returns 404 for non-existent task", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/tasks/non-existent-task/ai-runs",
      headers: { "Content-Type": "application/json" },
      payload: { success: false },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Task not found");
  });

  test("POST /api/tasks/:taskId/ai-runs - defaults profile and complexity", async () => {
    const task = await createTask({ title: "Default AI Run" });

    const res = await app.inject({
      method: "POST",
      url: `/api/tasks/${task.id}/ai-runs`,
      headers: { "Content-Type": "application/json" },
      payload: { success: false },
    });

    expect(res.statusCode).toBe(200);
    const run = res.json();
    expect(run.profile).toBe("feature");
    expect(run.complexity).toBe("medium");
    expect(run.success).toBe(0);
  });

  test("GET /api/tasks/:taskId/ai-runs - list AI runs for a task", async () => {
    const task = await createTask({ title: "List AI Runs" });

    // Create a couple of runs
    await app.inject({
      method: "POST",
      url: `/api/tasks/${task.id}/ai-runs`,
      headers: { "Content-Type": "application/json" },
      payload: { success: true, summary: "Run 1" },
    });
    await app.inject({
      method: "POST",
      url: `/api/tasks/${task.id}/ai-runs`,
      headers: { "Content-Type": "application/json" },
      payload: { success: false, summary: "Run 2" },
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/tasks/${task.id}/ai-runs`,
    });

    expect(res.statusCode).toBe(200);
    const runs = res.json();
    expect(Array.isArray(runs)).toBe(true);
    expect(runs.length).toBeGreaterThanOrEqual(2);
  });

  test("GET /api/tasks/:taskId/ai-runs - returns empty array for task with no runs", async () => {
    const task = await createTask({ title: "No Runs Task" });

    const res = await app.inject({
      method: "GET",
      url: `/api/tasks/${task.id}/ai-runs`,
    });

    expect(res.statusCode).toBe(200);
    const runs = res.json();
    expect(Array.isArray(runs)).toBe(true);
    expect(runs.length).toBe(0);
  });
});

// ===========================================================================
// AI Stats endpoint
// ===========================================================================

describe("AI stats endpoint", () => {
  test("GET /api/projects/:projectId/ai-stats - returns stats shape", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/ai-stats`,
    });

    expect(res.statusCode).toBe(200);
    const stats = res.json();
    expect(typeof stats.totalRuns).toBe("number");
    expect(typeof stats.successCount).toBe("number");
    expect(typeof stats.successRate).toBe("number");
    expect(typeof stats.profileBreakdown).toBe("object");
    expect(Array.isArray(stats.commonFailures)).toBe(true);
    expect(typeof stats.totalCostUsd).toBe("number");
    expect(typeof stats.runningCount).toBe("number");
  });

  test("GET /api/projects/:projectId/ai-stats - returns zero stats for project with no runs", async () => {
    // Create a clean project
    const projRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { "Content-Type": "application/json" },
      payload: { name: "Stats Project", path: `/tmp/test-stats-${Date.now()}` },
    });
    const statsProjId = projRes.json().id;

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${statsProjId}/ai-stats`,
    });

    expect(res.statusCode).toBe(200);
    const stats = res.json();
    expect(stats.totalRuns).toBe(0);
    expect(stats.successCount).toBe(0);
    expect(stats.successRate).toBe(0);
    expect(stats.avgDurationMs).toBeNull();

    // Cleanup
    await app.inject({ method: "DELETE", url: `/api/projects/${statsProjId}` });
  });

  test("GET /api/projects/:projectId/ai-stats - counts runs correctly", async () => {
    // Create a clean project and task
    const projRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { "Content-Type": "application/json" },
      payload: { name: "Stats Count Project", path: `/tmp/test-stats-count-${Date.now()}` },
    });
    const countProjId = projRes.json().id;

    const taskRes = await app.inject({
      method: "POST",
      url: `/api/projects/${countProjId}/tasks`,
      headers: { "Content-Type": "application/json" },
      payload: { title: "Stats Task" },
    });
    const taskId = taskRes.json().id;

    // Record some AI runs
    await app.inject({
      method: "POST",
      url: `/api/tasks/${taskId}/ai-runs`,
      headers: { "Content-Type": "application/json" },
      payload: { success: true, durationMs: 10000, profile: "feature" },
    });
    await app.inject({
      method: "POST",
      url: `/api/tasks/${taskId}/ai-runs`,
      headers: { "Content-Type": "application/json" },
      payload: { success: true, durationMs: 20000, profile: "bug-fix" },
    });
    await app.inject({
      method: "POST",
      url: `/api/tasks/${taskId}/ai-runs`,
      headers: { "Content-Type": "application/json" },
      payload: { success: false, durationMs: 5000, profile: "feature" },
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${countProjId}/ai-stats`,
    });

    expect(res.statusCode).toBe(200);
    const stats = res.json();
    expect(stats.totalRuns).toBe(3);
    expect(stats.successCount).toBe(2);
    expect(stats.successRate).toBe(67); // Math.round(2/3 * 100) = 67
    expect(stats.avgDurationMs).toBeDefined();
    expect(stats.avgDurationMs).toBeGreaterThan(0);
    expect(stats.profileBreakdown.feature).toBe(2);
    expect(stats.profileBreakdown["bug-fix"]).toBe(1);

    // Cleanup
    await app.inject({ method: "DELETE", url: `/api/projects/${countProjId}` });
  });
});
