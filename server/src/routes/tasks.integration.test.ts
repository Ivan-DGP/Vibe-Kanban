import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { buildApp } from "../app";

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
  await app.close();
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
    const todoTask = await createTask({ title: "Filter Todo Task", status: "todo", priority: "low" });
    _todoTaskId = todoTask.id;

    const ipTask = await createTask({ title: "Filter InProgress Task", status: "in_progress", priority: "high" });
    _inProgressTaskId = ipTask.id;

    const highTask = await createTask({ title: "Filter High Priority", status: "backlog", priority: "urgent" });
    _highPriorityTaskId = highTask.id;

    const searchTask = await createTask({ title: "UniqueKeyword XyzzyPlugh", description: "searchable content" });
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
});
