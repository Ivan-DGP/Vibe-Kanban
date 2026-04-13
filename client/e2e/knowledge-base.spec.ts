import { test, expect, Page } from '@playwright/test';

const BASE_API = 'http://localhost:3001/api';
const SEED_PROJECT_NAME = `E2E-Knowledge-${Date.now()}`;
const SEED_PROJECT_PATH = `/tmp/e2e-knowledge-${Date.now()}`;
let seedProjectId: string;

async function cleanupStaleE2EProjects() {
  try {
    const res = await fetch(`${BASE_API}/projects`);
    const projects: any[] = await res.json();
    for (const p of projects) {
      if (/^E2E-Knowledge/.test(p.name)) {
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

test.describe('Knowledge Base — Artifacts', () => {
  test('Knowledge tab is visible and switches correctly', async ({ page }) => {
    await page.goto(`/project/${seedProjectId}`, { waitUntil: 'networkidle' });
    await dismissOnboarding(page);

    // Find and click the Knowledge button
    const knowledgeBtn = page.getByRole('button', { name: /knowledge/i });
    await expect(knowledgeBtn).toBeVisible();
    await knowledgeBtn.click();

    // Should see the Artifacts, Roadmap, Graph tabs
    await expect(page.getByRole('tab', { name: /artifacts/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /roadmap/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /graph/i })).toBeVisible();
  });

  test('Empty state shows "No artifacts yet"', async ({ page }) => {
    await page.goto(`/project/${seedProjectId}`, { waitUntil: 'networkidle' });
    await dismissOnboarding(page);
    await page.getByRole('button', { name: /knowledge/i }).click();

    await expect(page.getByText(/no artifacts yet/i)).toBeVisible();
  });

  test('Create a document artifact', async ({ page }) => {
    await page.goto(`/project/${seedProjectId}`, { waitUntil: 'networkidle' });
    await dismissOnboarding(page);
    await page.getByRole('button', { name: /knowledge/i }).click();

    // Click New dropdown
    await page.getByRole('button', { name: /new/i }).click();
    await page.getByRole('menuitem', { name: /document/i }).click();

    // Should navigate to editor with untitled file
    await expect(page.getByDisplayValue(/untitled/i)).toBeVisible();
  });

  test('Artifact appears in the list after creation via API', async ({ page }) => {
    // Create artifact via API
    await fetch(`${BASE_API}/projects/${seedProjectId}/artifacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: 'test-doc.md',
        type: 'document',
        description: 'A test document',
        content: '# Test Document\n\nContent here.',
      }),
    });

    await page.goto(`/project/${seedProjectId}`, { waitUntil: 'networkidle' });
    await dismissOnboarding(page);
    await page.getByRole('button', { name: /knowledge/i }).click();

    await expect(page.getByText('test-doc.md')).toBeVisible();
    await expect(page.getByText('A test document')).toBeVisible();
  });

  test('Click artifact opens editor', async ({ page }) => {
    await page.goto(`/project/${seedProjectId}`, { waitUntil: 'networkidle' });
    await dismissOnboarding(page);
    await page.getByRole('button', { name: /knowledge/i }).click();

    await page.getByText('test-doc.md').click();

    // Editor should show filename input and save button
    await expect(page.getByDisplayValue('test-doc.md')).toBeVisible();
    await expect(page.getByRole('button', { name: /save/i })).toBeVisible();
  });
});

test.describe('Knowledge Base — Roadmap', () => {
  test('Roadmap tab shows empty state', async ({ page }) => {
    await page.goto(`/project/${seedProjectId}`, { waitUntil: 'networkidle' });
    await dismissOnboarding(page);
    await page.getByRole('button', { name: /knowledge/i }).click();
    await page.getByRole('tab', { name: /roadmap/i }).click();

    await expect(page.getByText(/no roadmap items/i)).toBeVisible();
  });

  test('Create roadmap item via dialog', async ({ page }) => {
    await page.goto(`/project/${seedProjectId}`, { waitUntil: 'networkidle' });
    await dismissOnboarding(page);
    await page.getByRole('button', { name: /knowledge/i }).click();
    await page.getByRole('tab', { name: /roadmap/i }).click();

    await page.getByRole('button', { name: /add item/i }).click();

    // Fill in the dialog
    await page.getByPlaceholder('Title').fill('Phase 1: Foundation');
    await page.getByRole('button', { name: /create/i }).click();

    // Item should appear in the timeline
    await expect(page.getByText('Phase 1: Foundation')).toBeVisible();
  });

  test('Roadmap items appear after API creation', async ({ page }) => {
    await fetch(`${BASE_API}/projects/${seedProjectId}/roadmap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'API Phase',
        status: 'in_progress',
        startDate: '2026-04-01',
        endDate: '2026-05-01',
      }),
    });

    await page.goto(`/project/${seedProjectId}`, { waitUntil: 'networkidle' });
    await dismissOnboarding(page);
    await page.getByRole('button', { name: /knowledge/i }).click();
    await page.getByRole('tab', { name: /roadmap/i }).click();

    await expect(page.getByText('API Phase')).toBeVisible();
  });
});

test.describe('Knowledge Base — Graph', () => {
  test('Graph tab shows empty state', async ({ page }) => {
    await page.goto(`/project/${seedProjectId}`, { waitUntil: 'networkidle' });
    await dismissOnboarding(page);
    await page.getByRole('button', { name: /knowledge/i }).click();
    await page.getByRole('tab', { name: /graph/i }).click();

    await expect(page.getByText(/no nodes yet/i)).toBeVisible();
  });

  test('Create node via dialog', async ({ page }) => {
    await page.goto(`/project/${seedProjectId}`, { waitUntil: 'networkidle' });
    await dismissOnboarding(page);
    await page.getByRole('button', { name: /knowledge/i }).click();
    await page.getByRole('tab', { name: /graph/i }).click();

    await page.getByRole('button', { name: /add node/i }).click();

    await page.getByPlaceholder('Label').fill('Auth System');
    await page.getByRole('button', { name: /create/i }).click();

    // Canvas should appear (empty state should be gone)
    await expect(page.getByText(/no nodes yet/i)).not.toBeVisible();
    // Should show node count
    await expect(page.getByText(/1 node/i)).toBeVisible();
  });

  test('Graph renders nodes created via API', async ({ page }) => {
    // Create nodes via API
    const nodeRes = await fetch(`${BASE_API}/projects/${seedProjectId}/graph/nodes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Database', type: 'technology' }),
    });
    const node = await nodeRes.json();

    await page.goto(`/project/${seedProjectId}`, { waitUntil: 'networkidle' });
    await dismissOnboarding(page);
    await page.getByRole('button', { name: /knowledge/i }).click();
    await page.getByRole('tab', { name: /graph/i }).click();

    // Should show correct node count
    await expect(page.getByText(/2 nodes/i)).toBeVisible();
  });
});

test.describe('Knowledge Base — Mode switching', () => {
  test('Can switch between Tasks, Editor, and Knowledge modes', async ({ page }) => {
    await page.goto(`/project/${seedProjectId}`, { waitUntil: 'networkidle' });
    await dismissOnboarding(page);

    // Start on Tasks mode
    const tasksBtn = page.getByRole('button', { name: /^tasks$/i });
    const editorBtn = page.getByRole('button', { name: /editor/i });
    const knowledgeBtn = page.getByRole('button', { name: /knowledge/i });

    // Switch to Knowledge
    await knowledgeBtn.click();
    await expect(page.getByRole('tab', { name: /artifacts/i })).toBeVisible();

    // Switch to Editor
    await editorBtn.click();
    await expect(page.getByRole('tab', { name: /artifacts/i })).not.toBeVisible();

    // Switch back to Tasks
    await tasksBtn.click();
    await expect(page.getByRole('tab', { name: /artifacts/i })).not.toBeVisible();
  });
});
