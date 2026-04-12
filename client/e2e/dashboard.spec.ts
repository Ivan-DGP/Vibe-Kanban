import { test, expect, Page } from '@playwright/test';

/**
 * Dismiss the onboarding wizard if it appears.
 * Checks each button with isVisible() before clicking.
 */
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

/**
 * Locate a project card on the dashboard by its name.
 * Uses data-slot="card" to target only the outer Card element (not children).
 */
function projectCard(page: Page, name: string) {
  return page.locator('[data-slot="card"]').filter({ hasText: name });
}

test.describe('Dashboard basics', () => {
  test('Dashboard loads with project cards', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await dismissOnboarding(page);

    // The dashboard heading should be visible
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();

    // There should be at least one project card rendered in the grid.
    // Project cards use shadcn Card with data-slot="card" and contain an h3 for the name.
    const cards = page.locator('[data-slot="card"]').filter({ has: page.locator('h3') });
    await expect(cards.first()).toBeVisible({ timeout: 10000 });

    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('Project card shows details (name, path)', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await dismissOnboarding(page);

    // Find the Vibe-Kanban project card
    const vibeCard = projectCard(page, 'Vibe-Kanban');
    await expect(vibeCard).toBeVisible({ timeout: 10000 });

    // The card should contain the project name in an h3
    await expect(vibeCard.locator('h3')).toContainText('Vibe-Kanban');

    // The card should show the project path (rendered in a mono-font span)
    const pathElement = vibeCard.locator('span.font-mono').first();
    await expect(pathElement).toBeVisible();
    const pathText = await pathElement.textContent();
    expect(pathText).toBeTruthy();
    expect(pathText!.length).toBeGreaterThan(0);
  });

  test('Navigate to project from dashboard', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await dismissOnboarding(page);

    // Click on the Vibe-Kanban project card
    const vibeCard = projectCard(page, 'Vibe-Kanban');
    await expect(vibeCard).toBeVisible({ timeout: 10000 });
    await vibeCard.click();

    // URL should change to /project/:id
    await page.waitForURL(/\/project\/[a-zA-Z0-9_-]+/, { timeout: 10000 });
    expect(page.url()).toMatch(/\/project\/[a-zA-Z0-9_-]+/);

    // The project detail page should show the project name in its header
    const projectHeading = page.locator('h1').filter({ hasText: 'Vibe-Kanban' });
    await expect(projectHeading).toBeVisible({ timeout: 10000 });

    // The kanban board should load — look for the "Tasks" mode button (active by default)
    const tasksButton = page.getByRole('button', { name: /^tasks$/i });
    await expect(tasksButton).toBeVisible({ timeout: 10000 });
  });

  test('Navigate back to dashboard via sidebar', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await dismissOnboarding(page);

    // Navigate to a project first
    const vibeCard = projectCard(page, 'Vibe-Kanban');
    await expect(vibeCard).toBeVisible({ timeout: 10000 });
    await vibeCard.click();
    await page.waitForURL(/\/project\//, { timeout: 10000 });

    // Now click the "Dashboard" nav link in the sidebar
    const dashboardLink = page.locator('nav').getByText('Dashboard');
    await expect(dashboardLink).toBeVisible({ timeout: 5000 });
    await dashboardLink.click();

    // Should be back on the root route
    await page.waitForURL(/\/$/, { timeout: 10000 });
    expect(page.url()).toMatch(/\/$/);

    // Dashboard heading should be visible again
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
  });
});

test.describe.serial('Create and delete project', () => {
  const testProjectName = `E2E-Test-${Date.now()}`;
  const testProjectPath = `/tmp/e2e-test-project-${Date.now()}`;

  test('Create a new project', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await dismissOnboarding(page);

    // Click "Add Project" button in the dashboard header
    const addBtn = page.getByRole('button', { name: /add project/i });
    await expect(addBtn).toBeVisible({ timeout: 5000 });
    await addBtn.click();

    // The dialog should open with the "Add Project" heading
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog.getByRole('heading', { name: 'Add Project' })).toBeVisible();

    // The "Browse" tab is active by default. Fill in path and name.
    // Path input (placeholder: "Paste a path or browse below...")
    const pathField = dialog.getByPlaceholder(/paste a path|browse below/i);
    await expect(pathField).toBeVisible({ timeout: 5000 });
    await pathField.fill(testProjectPath);

    // Project name input (placeholder: "Project name")
    const nameField = dialog.getByPlaceholder(/project name/i);
    await expect(nameField).toBeVisible({ timeout: 5000 });
    await nameField.fill(testProjectName);

    // Click the "Add Project" button inside the dialog
    const addProjectBtn = dialog.getByRole('button', { name: /add project/i });
    await expect(addProjectBtn).toBeEnabled();
    await addProjectBtn.click();

    // Wait for the dialog to close
    await expect(dialog).not.toBeVisible({ timeout: 10000 });

    // Verify the new project appears on the dashboard via its h3 heading
    await expect(page.locator('h3').filter({ hasText: testProjectName })).toBeVisible({ timeout: 10000 });
  });

  test('Delete the test project', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await dismissOnboarding(page);

    // Navigate to the test project by clicking its card
    const testCard = projectCard(page, testProjectName);
    await expect(testCard).toBeVisible({ timeout: 10000 });
    await testCard.click();

    // Wait for the project detail page to load
    await page.waitForURL(/\/project\//, { timeout: 10000 });
    await expect(page.locator('h1').filter({ hasText: testProjectName })).toBeVisible({ timeout: 10000 });

    // Open project settings by clicking the Settings2 icon button in the project header.
    // lucide-react renders it as svg.lucide-settings2. Scope to the header (border-b area)
    // to avoid matching similar icons in the sidebar.
    const header = page.locator('.border-b').filter({ has: page.locator('h1') });
    const settingsBtn = header.locator('button').filter({ has: page.locator('svg.lucide-settings2') });
    await expect(settingsBtn).toBeVisible({ timeout: 5000 });
    await settingsBtn.click();

    // The Project Settings dialog should be open
    const settingsDialog = page.getByRole('dialog');
    await expect(settingsDialog).toBeVisible({ timeout: 5000 });
    await expect(settingsDialog.getByText('Project Settings')).toBeVisible();

    // Click "Delete Project" button
    const deleteBtn = settingsDialog.getByRole('button', { name: /delete project/i });
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    // Confirmation dialog appears (AlertDialog)
    const confirmDialog = page.locator('[role="alertdialog"]');
    await expect(confirmDialog).toBeVisible({ timeout: 5000 });

    // Click "Continue" to confirm deletion
    const continueBtn = confirmDialog.getByRole('button', { name: /continue/i });
    await expect(continueBtn).toBeVisible();
    await continueBtn.click();

    // After deletion, should navigate back to dashboard (/)
    await page.waitForURL(/\/$/, { timeout: 10000 });

    // Verify the deleted project is no longer on the dashboard
    await expect(page.locator('h3').filter({ hasText: testProjectName })).not.toBeVisible({ timeout: 5000 });
  });
});
