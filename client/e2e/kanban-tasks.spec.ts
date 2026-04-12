import { test, expect, Page } from '@playwright/test';

const TASK_NAME = 'E2E Test Task';
const BASE_API = 'http://localhost:3001/api';
const SEED_PROJECT_NAME = `E2E-Kanban-${Date.now()}`;
const SEED_PROJECT_PATH = `/tmp/e2e-kanban-${Date.now()}`;
let seedProjectId: string;

/** Delete any leftover E2E-* projects from previous failed runs */
async function cleanupStaleE2EProjects() {
  try {
    const res = await fetch(`${BASE_API}/projects`);
    const projects: any[] = await res.json();
    for (const p of projects) {
      if (/^E2E-/.test(p.name)) {
        await fetch(`${BASE_API}/projects/${p.id}`, { method: 'DELETE' });
      }
    }
  } catch {}
}

async function cleanupTestTasks() {
  if (!seedProjectId) return;
  try {
    const tasksRes = await fetch(`${BASE_API}/projects/${seedProjectId}/tasks?limit=200`);
    const tasksData = await tasksRes.json();
    const tasks: any[] = tasksData.items ?? tasksData;
    for (const task of tasks) {
      if (task.title === TASK_NAME) {
        await fetch(`${BASE_API}/tasks/${task.id}`, { method: 'DELETE' });
      }
    }
  } catch {}
}

async function dismissOnboarding(page: Page) {
  const getStartedBtn = page.getByRole('button', { name: /get started/i });
  if (await getStartedBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await getStartedBtn.click();
    const skipBtn = page.getByRole('button', { name: /skip/i });
    if (await skipBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await skipBtn.click();
    }
    const startBtn = page.getByRole('button', { name: /start using vibe kanban/i });
    if (await startBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await startBtn.click();
    }
  }
}

async function navigateToKanban(page: Page) {
  await page.goto('/', { waitUntil: 'networkidle' });
  await dismissOnboarding(page);

  await page.waitForTimeout(1000);
  const projectCard = page.locator(`text=${SEED_PROJECT_NAME}`).first();
  await expect(projectCard).toBeVisible({ timeout: 10000 });
  await projectCard.click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
}

test.describe.serial('Kanban board task workflow', () => {
  test.beforeAll(async () => {
    await cleanupStaleE2EProjects();
    const res = await fetch(`${BASE_API}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: SEED_PROJECT_NAME, path: SEED_PROJECT_PATH }),
    });
    const data = await res.json();
    seedProjectId = data.id;
    await cleanupTestTasks();
  });

  test.afterAll(async () => {
    await cleanupTestTasks();
    if (seedProjectId) {
      await fetch(`${BASE_API}/projects/${seedProjectId}`, { method: 'DELETE' });
    }
  });

  test.beforeEach(async ({ page }) => {
    page.setDefaultTimeout(15000);
  });

  test('Navigate to project kanban board', async ({ page }) => {
    await navigateToKanban(page);

    await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'In Progress' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Done' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Approved' })).toBeVisible();
  });

  test('Create a new task', async ({ page }) => {
    await navigateToKanban(page);

    const newTaskBtn = page.getByRole('button', { name: /new task/i });
    await expect(newTaskBtn).toBeVisible();
    await newTaskBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const titleInput = dialog.locator('input[placeholder="Task title"]');
    await titleInput.fill(TASK_NAME);

    const prioritySection = dialog.locator('.space-y-2').filter({ hasText: 'Priority' });
    const priorityTrigger = prioritySection.locator('[role="combobox"]');
    await priorityTrigger.click();
    const highOption = page.getByRole('option', { name: 'High' });
    await expect(highOption).toBeVisible();
    await highOption.click();

    const createBtn = dialog.getByRole('button', { name: 'Create' });
    await createBtn.click();

    await expect(dialog).not.toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1500);
    await expect(page.getByText(TASK_NAME).first()).toBeVisible({ timeout: 10000 });
  });

  test('Open task viewer', async ({ page }) => {
    await navigateToKanban(page);

    const taskCard = page.getByText(TASK_NAME).first();
    await expect(taskCard).toBeVisible({ timeout: 10000 });
    await taskCard.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog.getByText(TASK_NAME)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible({ timeout: 5000 });
  });

  test('Edit task', async ({ page }) => {
    await navigateToKanban(page);

    const taskCard = page.getByText(TASK_NAME).first();
    await expect(taskCard).toBeVisible({ timeout: 10000 });
    await taskCard.click();

    const viewerDialog = page.getByRole('dialog');
    await expect(viewerDialog).toBeVisible({ timeout: 5000 });

    const editBtn = viewerDialog.getByRole('button', { name: /edit/i });
    await editBtn.click();

    const editorDialog = page.getByRole('dialog');
    await expect(editorDialog).toBeVisible({ timeout: 5000 });

    const descriptionTextarea = editorDialog.locator('textarea[placeholder="Product/user-facing description..."]');
    await descriptionTextarea.fill('Updated via E2E test');

    const saveBtn = editorDialog.getByRole('button', { name: 'Save' });
    await saveBtn.click();
    await expect(editorDialog).not.toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1500);

    // Verify description persisted
    const updatedCard = page.getByText(TASK_NAME).first();
    await updatedCard.click();
    const verifyDialog = page.getByRole('dialog');
    await expect(verifyDialog).toBeVisible({ timeout: 5000 });
    await expect(verifyDialog.getByText('Updated via E2E test')).toBeVisible();

    await page.keyboard.press('Escape');
  });

  test('Change task status', async ({ page }) => {
    await navigateToKanban(page);

    const taskCard = page.getByText(TASK_NAME).first();
    await expect(taskCard).toBeVisible({ timeout: 10000 });
    await taskCard.click();

    const viewerDialog = page.getByRole('dialog');
    await expect(viewerDialog).toBeVisible({ timeout: 5000 });

    const editBtn = viewerDialog.getByRole('button', { name: /edit/i });
    await editBtn.click();

    const editorDialog = page.getByRole('dialog');
    await expect(editorDialog).toBeVisible({ timeout: 5000 });

    const statusSection = editorDialog.locator('.space-y-2').filter({ hasText: 'Status' });
    const statusTrigger = statusSection.locator('[role="combobox"]');
    await statusTrigger.click();
    const inProgressOption = page.getByRole('option', { name: 'In Progress' });
    await inProgressOption.click();

    const saveBtn = editorDialog.getByRole('button', { name: 'Save' });
    await saveBtn.click();
    await expect(editorDialog).not.toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(2000);

    const inProgressHeading = page.getByRole('heading', { name: 'In Progress' });
    const inProgressColumn = page.locator('div').filter({ has: inProgressHeading }).filter({ hasText: TASK_NAME });
    await expect(inProgressColumn.first()).toBeVisible({ timeout: 10000 });
  });

  test('Delete test task', async ({ page }) => {
    await navigateToKanban(page);

    const taskCard = page.getByText(TASK_NAME).first();
    await expect(taskCard).toBeVisible({ timeout: 10000 });
    await taskCard.click();
    await page.waitForTimeout(500);

    let viewerDialog = page.getByRole('dialog');
    if (!await viewerDialog.isVisible({ timeout: 3000 }).catch(() => false)) {
      const cardElement = page.locator('.rounded-lg.border.bg-card').filter({ hasText: TASK_NAME }).first();
      await cardElement.click({ force: true });
    }

    viewerDialog = page.getByRole('dialog');
    await expect(viewerDialog).toBeVisible({ timeout: 5000 });

    const deleteBtn = viewerDialog.getByRole('button', { name: /delete/i });
    await deleteBtn.click();

    const confirmBtn = page.getByRole('button', { name: /continue/i });
    await expect(confirmBtn).toBeVisible({ timeout: 5000 });
    await confirmBtn.click();

    await page.waitForTimeout(2000);
    await expect(page.getByText(TASK_NAME)).not.toBeVisible({ timeout: 10000 });
  });
});
