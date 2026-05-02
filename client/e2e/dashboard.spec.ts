import { test, expect, Page } from '@playwright/test';

const BASE_API = 'http://localhost:3001/api';
const SEED_PROJECT_NAME = `E2E-Seed-${Date.now()}`;
const SEED_PROJECT_PATH = `/tmp/e2e-seed-${Date.now()}`;
let seedProjectId: string;

/** Delete any leftover dashboard-spec projects from previous failed runs.
 *  Scoped to this spec's own prefixes so it does not race other parallel workers. */
async function cleanupStaleE2EProjects() {
  try {
    const res = await fetch(`${BASE_API}/projects`);
    const projects: any[] = await res.json();
    for (const p of projects) {
      if (/^E2E-(Seed|CreateDel)-/.test(p.name)) {
        await fetch(`${BASE_API}/projects/${p.id}`, { method: 'DELETE' });
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

function projectCard(page: Page, name: string) {
  return page.locator('[data-slot="card"]').filter({ hasText: name });
}

// Clean up stale E2E projects, then seed a fresh one
test.beforeAll(async () => {
  await cleanupStaleE2EProjects();
  const res = await fetch(`${BASE_API}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: SEED_PROJECT_NAME, path: SEED_PROJECT_PATH }),
  });
  const data = await res.json();
  seedProjectId = data.id;
});

test.afterAll(async () => {
  if (seedProjectId) {
    await fetch(`${BASE_API}/projects/${seedProjectId}`, { method: 'DELETE' });
  }
});

test.describe('Dashboard basics', () => {
  test('Dashboard loads with project cards', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await dismissOnboarding(page);

    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();

    const cards = page.locator('[data-slot="card"]').filter({ has: page.locator('h3') });
    await expect(cards.first()).toBeVisible({ timeout: 10000 });

    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('Project card shows details (name, path)', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await dismissOnboarding(page);

    const card = projectCard(page, SEED_PROJECT_NAME);
    await expect(card).toBeVisible({ timeout: 10000 });

    await expect(card.locator('h3')).toContainText(SEED_PROJECT_NAME);

    const pathElement = card.locator('span.font-mono').first();
    await expect(pathElement).toBeVisible();
    const pathText = await pathElement.textContent();
    expect(pathText).toBeTruthy();
  });

  test('Navigate to project from dashboard', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await dismissOnboarding(page);

    const card = projectCard(page, SEED_PROJECT_NAME);
    await expect(card).toBeVisible({ timeout: 10000 });
    await card.click();

    await page.waitForURL(/\/project\/[a-zA-Z0-9_-]+/, { timeout: 10000 });
    expect(page.url()).toMatch(/\/project\/[a-zA-Z0-9_-]+/);

    const projectHeading = page.locator('h1').filter({ hasText: SEED_PROJECT_NAME });
    await expect(projectHeading).toBeVisible({ timeout: 10000 });
  });

  test('Navigate back to dashboard via sidebar', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await dismissOnboarding(page);

    const card = projectCard(page, SEED_PROJECT_NAME);
    await expect(card).toBeVisible({ timeout: 10000 });
    await card.click();
    await page.waitForURL(/\/project\//, { timeout: 10000 });

    const dashboardLink = page.locator('nav').getByText('Dashboard');
    await expect(dashboardLink).toBeVisible({ timeout: 5000 });
    await dashboardLink.click();

    await page.waitForURL(/\/$/, { timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  });
});

test.describe.serial('Create and delete project', () => {
  const testProjectName = `E2E-CreateDel-${Date.now()}`;
  const testProjectPath = `/tmp/e2e-test-project-${Date.now()}`;

  // Safety net: clean up the project via API if the UI delete test fails
  test.afterAll(async () => {
    try {
      const res = await fetch(`${BASE_API}/projects`);
      const projects: any[] = await res.json();
      for (const p of projects) {
        if (p.name === testProjectName) {
          await fetch(`${BASE_API}/projects/${p.id}`, { method: 'DELETE' });
        }
      }
    } catch {}
  });

  test('Create a new project', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await dismissOnboarding(page);

    const addBtn = page.getByRole('button', { name: /add project/i });
    await expect(addBtn).toBeVisible({ timeout: 5000 });
    await addBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const pathField = dialog.getByPlaceholder(/paste a path|browse below/i);
    await expect(pathField).toBeVisible({ timeout: 5000 });
    await pathField.fill(testProjectPath);

    const nameField = dialog.getByPlaceholder(/project name/i);
    await expect(nameField).toBeVisible({ timeout: 5000 });
    await nameField.fill(testProjectName);

    const addProjectBtn = dialog.getByRole('button', { name: /add project/i });
    await expect(addProjectBtn).toBeEnabled();
    await addProjectBtn.click();

    await expect(dialog).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('h3').filter({ hasText: testProjectName })).toBeVisible({ timeout: 10000 });
  });

  test('Delete the test project', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await dismissOnboarding(page);

    const testCard = projectCard(page, testProjectName);
    await expect(testCard).toBeVisible({ timeout: 10000 });
    await testCard.click();

    await page.waitForURL(/\/project\//, { timeout: 10000 });

    const header = page.locator('.border-b').filter({ has: page.locator('h1') });
    const settingsBtn = header.locator('button').filter({ has: page.locator('svg.lucide-settings2') });
    await expect(settingsBtn).toBeVisible({ timeout: 5000 });
    await settingsBtn.click();

    const settingsDialog = page.getByRole('dialog');
    await expect(settingsDialog).toBeVisible({ timeout: 5000 });

    const deleteBtn = settingsDialog.getByRole('button', { name: /delete project/i });
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    const confirmDialog = page.locator('[role="alertdialog"]');
    await expect(confirmDialog).toBeVisible({ timeout: 5000 });
    const continueBtn = confirmDialog.getByRole('button', { name: /continue/i });
    await continueBtn.click();

    await page.waitForURL(/\/$/, { timeout: 10000 });
    await expect(page.locator('h3').filter({ hasText: testProjectName })).not.toBeVisible({ timeout: 5000 });
  });
});
