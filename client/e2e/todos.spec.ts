import { test, expect, Page } from "@playwright/test";

const API = "http://localhost:3001/api";

/** Dismiss the onboarding wizard if it appears. */
async function dismissOnboarding(page: Page) {
  const getStartedBtn = page.getByRole("button", { name: /get started/i });
  if (await getStartedBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await getStartedBtn.click();
    const skipBtn = page.getByRole("button", { name: /skip/i });
    if (await skipBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await skipBtn.click();
    }
    const startBtn = page.getByRole("button", {
      name: /start using vibe kanban/i,
    });
    if (await startBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await startBtn.click();
    }
  }
}

/** Delete all existing todos via the API so each run starts clean. */
async function deleteAllTodos(request: import("@playwright/test").APIRequestContext) {
  const resp = await request.get(`${API}/todos`);
  if (resp.ok()) {
    const todos: { id: string }[] = await resp.json();
    for (const todo of todos) {
      await request.delete(`${API}/todos/${todo.id}`);
    }
  }
}

test.describe.serial("Todos page", () => {
  let page: Page;

  test.beforeAll(async ({ browser, request }) => {
    // Clean slate: remove any leftover todos from prior runs
    await deleteAllTodos(request);

    page = await browser.newPage();
    await page.goto("/", { waitUntil: "networkidle" });
    await dismissOnboarding(page);
  });

  test.afterAll(async ({ request }) => {
    // Clean up todos created during the test run
    await deleteAllTodos(request);
    await page.close();
  });

  test("Todos page loads", async () => {
    // Navigate to /todos via sidebar link
    const todoLink = page.getByRole("link", { name: /^todo$/i });
    if (await todoLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await todoLink.click();
    } else {
      await page.goto("/todos", { waitUntil: "networkidle" });
    }

    await page.waitForURL("**/todos");

    // The page heading should be visible
    await expect(page.getByRole("heading", { name: /todo/i })).toBeVisible();
  });

  test("Create a todo", async () => {
    const input = page.getByPlaceholder(/add a new todo/i);
    await expect(input).toBeVisible();

    await input.fill("E2E Todo Item");
    await input.press("Enter");

    // Verify the new todo appears in the list
    await expect(
      page.getByText("E2E Todo Item", { exact: true })
    ).toBeVisible({ timeout: 5000 });
  });

  test("Create a second todo", async () => {
    const input = page.getByPlaceholder(/add a new todo/i);
    await input.fill("Another E2E Todo");
    await input.press("Enter");

    // Both todos should be visible
    await expect(
      page.getByText("Another E2E Todo", { exact: true })
    ).toBeVisible({ timeout: 5000 });
    await expect(
      page.getByText("E2E Todo Item", { exact: true })
    ).toBeVisible();
  });

  test("Toggle todo completion", async () => {
    // Find the todo item row containing "E2E Todo Item"
    const todoRow = page
      .locator("div")
      .filter({ hasText: /^E2E Todo Item$/ })
      .filter({ has: page.getByRole("checkbox") })
      .first();

    const checkbox = todoRow.getByRole("checkbox");
    await expect(checkbox).toBeVisible();

    // Should start unchecked
    await expect(checkbox).toHaveAttribute("data-state", "unchecked");

    // Toggle it
    await checkbox.click();

    // Should now be checked
    await expect(checkbox).toHaveAttribute("data-state", "checked", {
      timeout: 5000,
    });

    // The text should gain line-through styling
    const todoText = todoRow.locator("span.line-through");
    await expect(todoText).toBeVisible({ timeout: 5000 });
  });

  test("Delete a todo", async () => {
    // Find the row for "Another E2E Todo"
    const todoRow = page
      .locator("div")
      .filter({ hasText: /^Another E2E Todo$/ })
      .filter({ has: page.getByRole("checkbox") })
      .first();

    // The delete button is hidden until hover (group-hover:flex).
    // Hover the row to reveal it.
    await todoRow.hover();

    // Wait briefly for the CSS transition, then click the delete button.
    const deleteBtn = todoRow.getByRole("button");
    await expect(deleteBtn).toBeVisible({ timeout: 5000 });
    await deleteBtn.click();

    // "Another E2E Todo" should disappear
    await expect(
      page.getByText("Another E2E Todo", { exact: true })
    ).toBeHidden({ timeout: 5000 });

    // "E2E Todo Item" should still be present
    await expect(
      page.getByText("E2E Todo Item", { exact: true })
    ).toBeVisible();
  });

  test("Clear completed", async () => {
    // "E2E Todo Item" was toggled completed in a previous test.
    // The "Clear completed" button should be visible.
    const clearBtn = page.getByRole("button", { name: /clear completed/i });
    await expect(clearBtn).toBeVisible({ timeout: 5000 });

    await clearBtn.click();

    // The completed todo should be gone
    await expect(
      page.getByText("E2E Todo Item", { exact: true })
    ).toBeHidden({ timeout: 5000 });
  });
});
