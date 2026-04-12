import { test, expect, Page } from '@playwright/test';

const TASK_NAME = 'E2E Test Task';
const BASE_API = 'http://localhost:3001/api';

/**
 * Clean up any leftover test tasks from prior runs so selectors are not ambiguous.
 */
async function cleanupTestTasks() {
  const projRes = await fetch(`${BASE_API}/projects`);
  const projects: any[] = await projRes.json();
  for (const project of projects) {
    if (!project.name?.includes('Vibe-Kanban') && !project.name?.includes('Vibe Kanban')) continue;
    const tasksRes = await fetch(`${BASE_API}/projects/${project.id}/tasks?limit=200`);
    const tasksData = await tasksRes.json();
    const tasks: any[] = tasksData.items ?? tasksData;
    for (const task of tasks) {
      if (task.title === TASK_NAME) {
        await fetch(`${BASE_API}/tasks/${task.id}`, { method: 'DELETE' });
      }
    }
  }
}

/**
 * Dismiss the onboarding wizard if it appears, then navigate to the
 * Vibe-Kanban project Kanban board.
 */
async function navigateToKanban(page: Page) {
  await page.goto('/', { waitUntil: 'networkidle' });

  // Dismiss onboarding wizard if present
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

  // Wait for the dashboard to load, then click the project card
  await page.waitForTimeout(1000);
  const projectCard = page.locator('text=Vibe-Kanban').first();
  await expect(projectCard).toBeVisible({ timeout: 10000 });
  await projectCard.click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
}

test.describe.serial('Kanban board task workflow', () => {
  test.beforeAll(async () => {
    await cleanupTestTasks();
  });

  test.afterAll(async () => {
    // Clean up test tasks after the suite runs regardless of pass/fail
    await cleanupTestTasks();
  });

  test.beforeEach(async ({ page }) => {
    page.setDefaultTimeout(15000);
  });

  test('Navigate to project kanban board', async ({ page }) => {
    await navigateToKanban(page);

    // Verify Kanban column headings are visible
    await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'In Progress' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Done' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Approved' })).toBeVisible();
  });

  test('Create a new task', async ({ page }) => {
    await navigateToKanban(page);

    // Click "New Task" button
    const newTaskBtn = page.getByRole('button', { name: /new task/i });
    await expect(newTaskBtn).toBeVisible();
    await newTaskBtn.click();

    // Wait for the Create Task dialog to open
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Create Task')).toBeVisible();

    // Fill in the title
    const titleInput = dialog.locator('input[placeholder="Task title"]');
    await expect(titleInput).toBeVisible();
    await titleInput.fill(TASK_NAME);

    // Set priority to "high" via shadcn Select
    const prioritySection = dialog.locator('.space-y-2').filter({ hasText: 'Priority' });
    const priorityTrigger = prioritySection.locator('[role="combobox"]');
    await priorityTrigger.click();

    const highOption = page.getByRole('option', { name: 'High' });
    await expect(highOption).toBeVisible();
    await highOption.click();

    // Click the "Create" button
    const createBtn = dialog.getByRole('button', { name: 'Create' });
    await expect(createBtn).toBeEnabled();
    await createBtn.click();

    // Wait for dialog to close and board to refresh
    await expect(dialog).not.toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1500);

    // Verify the task appears on the board (in the Inbox column)
    await expect(page.getByText(TASK_NAME).first()).toBeVisible({ timeout: 10000 });
  });

  test('Open task viewer', async ({ page }) => {
    await navigateToKanban(page);

    // Click on the task card
    const taskCard = page.getByText(TASK_NAME).first();
    await expect(taskCard).toBeVisible({ timeout: 10000 });
    await taskCard.click();

    // Verify dialog opens showing task details
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog.getByText(TASK_NAME)).toBeVisible();
    // Status badge shows "Inbox" (default "todo" maps to "Inbox" label)
    await expect(dialog.locator('[data-variant="secondary"]', { hasText: 'Inbox' })).toBeVisible();

    // Close the dialog
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible({ timeout: 5000 });
  });

  test('Edit task', async ({ page }) => {
    await navigateToKanban(page);

    // Open the task viewer
    const taskCard = page.getByText(TASK_NAME).first();
    await expect(taskCard).toBeVisible({ timeout: 10000 });
    await taskCard.click();

    const viewerDialog = page.getByRole('dialog');
    await expect(viewerDialog).toBeVisible({ timeout: 5000 });

    // Click "Edit" in the viewer
    const editBtn = viewerDialog.getByRole('button', { name: /edit/i });
    await expect(editBtn).toBeVisible();
    await editBtn.click();

    // Editor dialog opens
    const editorDialog = page.getByRole('dialog');
    await expect(editorDialog).toBeVisible({ timeout: 5000 });
    await expect(editorDialog.getByText('Edit Task')).toBeVisible();

    // Fill in description (Description tab is active by default)
    const descriptionTextarea = editorDialog.locator('textarea[placeholder="Product/user-facing description..."]');
    await expect(descriptionTextarea).toBeVisible();
    await descriptionTextarea.fill('Updated via E2E test');

    // Save
    const saveBtn = editorDialog.getByRole('button', { name: 'Save' });
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();

    // Wait for dialog to close and board to refresh
    await expect(editorDialog).not.toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1500);

    // Re-open the task to verify the description persisted
    const updatedTaskCard = page.getByText(TASK_NAME).first();
    await expect(updatedTaskCard).toBeVisible({ timeout: 10000 });
    await updatedTaskCard.click();

    const verifyDialog = page.getByRole('dialog');
    await expect(verifyDialog).toBeVisible({ timeout: 5000 });
    await expect(verifyDialog.getByText('Updated via E2E test')).toBeVisible();

    // Close
    await page.keyboard.press('Escape');
    await expect(verifyDialog).not.toBeVisible({ timeout: 5000 });
  });

  test('Change task status', async ({ page }) => {
    await navigateToKanban(page);

    // Open the task viewer
    const taskCard = page.getByText(TASK_NAME).first();
    await expect(taskCard).toBeVisible({ timeout: 10000 });
    await taskCard.click();

    const viewerDialog = page.getByRole('dialog');
    await expect(viewerDialog).toBeVisible({ timeout: 5000 });

    // Click Edit to open the editor
    const editBtn = viewerDialog.getByRole('button', { name: /edit/i });
    await expect(editBtn).toBeVisible();
    await editBtn.click();

    const editorDialog = page.getByRole('dialog');
    await expect(editorDialog).toBeVisible({ timeout: 5000 });
    await expect(editorDialog.getByText('Edit Task')).toBeVisible();

    // Change status to "In Progress"
    const statusSection = editorDialog.locator('.space-y-2').filter({ hasText: 'Status' });
    const statusTrigger = statusSection.locator('[role="combobox"]');
    await statusTrigger.click();

    const inProgressOption = page.getByRole('option', { name: 'In Progress' });
    await expect(inProgressOption).toBeVisible();
    await inProgressOption.click();

    // Save
    const saveBtn = editorDialog.getByRole('button', { name: 'Save' });
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();

    // Wait for dialog to close and board to refresh
    await expect(editorDialog).not.toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(2000);

    // Verify the task now appears in the "In Progress" column
    const inProgressHeading = page.getByRole('heading', { name: 'In Progress' });
    const inProgressColumn = page.locator('div').filter({ has: inProgressHeading }).filter({ hasText: TASK_NAME });
    await expect(inProgressColumn.first()).toBeVisible({ timeout: 10000 });
  });

  test('Delete test task', async ({ page }) => {
    await navigateToKanban(page);

    // The task is now in "In Progress" from the previous test.
    // Click on the task card to open the viewer dialog.
    const taskCard = page.getByText(TASK_NAME).first();
    await expect(taskCard).toBeVisible({ timeout: 10000 });
    await taskCard.click();
    await page.waitForTimeout(500);

    // If the dialog did not open (e.g. click hit a drag handler), retry with force
    let viewerDialog = page.getByRole('dialog');
    if (!await viewerDialog.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Try clicking the card container element instead
      const cardElement = page.locator('.rounded-lg.border.bg-card').filter({ hasText: TASK_NAME }).first();
      await cardElement.click({ force: true });
    }

    viewerDialog = page.getByRole('dialog');
    await expect(viewerDialog).toBeVisible({ timeout: 5000 });

    // Click "Delete"
    const deleteBtn = viewerDialog.getByRole('button', { name: /delete/i });
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    // Confirm deletion in the AlertDialog
    const confirmBtn = page.getByRole('button', { name: /continue/i });
    await expect(confirmBtn).toBeVisible({ timeout: 5000 });
    await confirmBtn.click();

    // Wait for dialogs to close and board to refresh
    await page.waitForTimeout(2000);

    // Verify task is no longer on the board
    await expect(page.getByText(TASK_NAME)).not.toBeVisible({ timeout: 10000 });
  });
});
