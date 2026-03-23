import { test, expect, Page, ConsoleMessage } from '@playwright/test';
import path from 'path';
import fs from 'fs';

// Use process.cwd() which Playwright resolves correctly on Windows
const SCREENSHOTS_DIR = path.join(process.cwd(), 'client', 'e2e', 'screenshots');
const BASE_URL = 'http://localhost:5173';

// Ensure screenshots directory exists
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

const consoleErrors: string[] = [];
const consoleWarnings: string[] = [];

async function screenshot(page: Page, name: string) {
  const filePath = path.join(SCREENSHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  console.log(`Screenshot saved: ${filePath}`);
  return filePath;
}

test('Vibe Kanban full walkthrough', async ({ page }) => {
  // Collect console messages throughout
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') {
      consoleErrors.push(`[ERROR] ${msg.text()}`);
    } else if (msg.type() === 'warning') {
      consoleWarnings.push(`[WARN] ${msg.text()}`);
    }
  });

  page.on('pageerror', (err) => {
    consoleErrors.push(`[PAGE ERROR] ${err.message}`);
  });

  // ─── Step 1: Navigate to app ───────────────────────────────────────────────
  console.log('Step 1: Navigating to http://localhost:5173');
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await screenshot(page, '01-initial-load');
  console.log('Page title:', await page.title());

  // ─── Step 2: Dismiss onboarding wizard if present ─────────────────────────
  console.log('Step 2: Checking for onboarding wizard...');

  // Look for "Get Started" button
  const getStartedBtn = page.getByRole('button', { name: /get started/i });
  if (await getStartedBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log('  Found "Get Started" button, clicking...');
    await getStartedBtn.click();
    await page.waitForTimeout(800);
    await screenshot(page, '02a-after-get-started');

    // Look for "Skip" button
    const skipBtn = page.getByRole('button', { name: /skip/i });
    if (await skipBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('  Found "Skip" button, clicking...');
      await skipBtn.click();
      await page.waitForTimeout(800);
      await screenshot(page, '02b-after-skip');
    }

    // Look for "Start Using Vibe Kanban"
    const startBtn = page.getByRole('button', { name: /start using vibe kanban/i });
    if (await startBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('  Found "Start Using Vibe Kanban" button, clicking...');
      await startBtn.click();
      await page.waitForTimeout(800);
    }
  } else {
    console.log('  No onboarding wizard detected, continuing...');
  }

  // ─── Step 3: Dashboard screenshot ─────────────────────────────────────────
  console.log('Step 3: Taking dashboard screenshot...');
  await page.waitForTimeout(1000);
  await screenshot(page, '03-dashboard');

  // Check for "Test Project" card
  const projectCard = page.getByText('Test Project', { exact: false });
  const projectVisible = await projectCard.isVisible({ timeout: 5000 }).catch(() => false);
  console.log(`  "Test Project" card visible: ${projectVisible}`);
  if (!projectVisible) {
    const bodyText = await page.locator('body').innerText();
    console.log('  Body text (first 500 chars):', bodyText.substring(0, 500));
  }

  // ─── Step 4: Click "Test Project" card ────────────────────────────────────
  console.log('Step 4: Clicking "Test Project" card...');
  if (projectVisible) {
    // Try to find the clickable card — could be a link, button, or div
    const cardLink = page.locator('a, button, [role="button"]').filter({ hasText: 'Test Project' }).first();
    const cardLinkVisible = await cardLink.isVisible({ timeout: 2000 }).catch(() => false);
    if (cardLinkVisible) {
      await cardLink.click();
    } else {
      await projectCard.first().click();
    }
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
  } else {
    console.log('  WARNING: Test Project card not found — skipping click');
  }
  await screenshot(page, '04-project-detail');
  console.log('  Current URL:', page.url());

  // ─── Step 5: Check Kanban board / task visibility ─────────────────────────
  console.log('Step 5: Checking for Kanban board and "Test kanban task"...');
  const taskCard = page.getByText('Test kanban task', { exact: false });
  const taskVisible = await taskCard.isVisible({ timeout: 5000 }).catch(() => false);
  console.log(`  "Test kanban task" visible: ${taskVisible}`);

  const inProgressColumn = page.getByText('In Progress', { exact: false });
  const inProgressVisible = await inProgressColumn.isVisible({ timeout: 3000 }).catch(() => false);
  console.log(`  "In Progress" column visible: ${inProgressVisible}`);

  // ─── Step 6: Click on the task card to open task viewer dialog ────────────
  console.log('Step 6: Clicking on task card to open task viewer dialog...');
  if (taskVisible) {
    await taskCard.first().click();
    await page.waitForTimeout(1200);
  } else {
    console.log('  WARNING: Task card not found — trying any visible card');
  }
  await screenshot(page, '06-task-dialog-open');

  // Check if dialog is open
  const dialog = page.getByRole('dialog');
  const dialogVisible = await dialog.isVisible({ timeout: 3000 }).catch(() => false);
  console.log(`  Dialog visible: ${dialogVisible}`);
  if (dialogVisible) {
    const dialogText = await dialog.innerText().catch(() => '');
    console.log('  Dialog content (first 300 chars):', dialogText.substring(0, 300));
  }

  // ─── Step 7: Close the dialog ─────────────────────────────────────────────
  console.log('Step 7: Closing the dialog...');
  if (dialogVisible) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    const dialogStillOpen = await dialog.isVisible({ timeout: 1000 }).catch(() => false);
    if (dialogStillOpen) {
      const closeBtn = page.getByRole('button', { name: /close|dismiss/i });
      if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await closeBtn.first().click();
      }
    }
    await page.waitForTimeout(500);
  }

  // ─── Step 8: Click "New Task" button ──────────────────────────────────────
  console.log('Step 8: Clicking "New Task" button...');
  const newTaskBtn = page.getByRole('button', { name: /new task/i });
  const newTaskVisible = await newTaskBtn.isVisible({ timeout: 5000 }).catch(() => false);
  console.log(`  "New Task" button visible: ${newTaskVisible}`);
  if (newTaskVisible) {
    await newTaskBtn.first().click();
    await page.waitForTimeout(1000);
    await screenshot(page, '08-new-task-dialog');
  } else {
    // Log all buttons on page
    const buttons = await page.getByRole('button').all();
    const buttonTexts = await Promise.all(buttons.map(b => b.innerText().catch(() => '?')));
    console.log('  Visible buttons:', buttonTexts.slice(0, 20).join(' | '));
    await screenshot(page, '08-new-task-no-button');
  }

  // ─── Step 9: Fill in "Bug fix" task with "urgent" priority ────────────────
  console.log('Step 9: Filling in new task form...');

  // Title field — look inside a dialog or sheet
  const titleInput = page.getByPlaceholder(/title|task name|task title/i)
    .or(page.getByLabel(/title/i));
  const titleVisible = await titleInput.isVisible({ timeout: 3000 }).catch(() => false);
  if (titleVisible) {
    await titleInput.first().fill('Bug fix');
    console.log('  Filled title: "Bug fix"');
  } else {
    // Broader search: any text input that might be visible
    const anyInput = page.locator('input[type="text"]:visible, input:not([type]):visible, textarea:visible').first();
    if (await anyInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await anyInput.fill('Bug fix');
      console.log('  Filled first visible text input with "Bug fix"');
    } else {
      console.log('  WARNING: Title input not found');
    }
  }

  // Priority field — look for select or buttons with "urgent"
  const priorityLabel = page.getByLabel(/priority/i);
  const priorityVisible = await priorityLabel.isVisible({ timeout: 2000 }).catch(() => false);
  if (priorityVisible) {
    const tagName = await priorityLabel.evaluate((el: Element) => el.tagName.toLowerCase()).catch(() => '');
    if (tagName === 'select') {
      await (priorityLabel as any).selectOption('urgent');
    } else {
      await priorityLabel.click();
      await page.waitForTimeout(300);
      const urgentOpt = page.getByRole('option', { name: /urgent/i }).or(page.getByText(/^urgent$/i));
      if (await urgentOpt.isVisible({ timeout: 2000 }).catch(() => false)) {
        await urgentOpt.first().click();
      }
    }
    console.log('  Set priority to urgent via label');
  } else {
    // Try clicking a priority toggle directly
    const urgentOpt = page.getByRole('radio', { name: /urgent/i })
      .or(page.getByRole('option', { name: /urgent/i }))
      .or(page.getByRole('button', { name: /urgent/i }));
    if (await urgentOpt.isVisible({ timeout: 2000 }).catch(() => false)) {
      await urgentOpt.first().click();
      console.log('  Clicked urgent priority option');
    } else {
      // Look for any element containing "urgent"
      const urgentEl = page.locator('[value="urgent"], [data-value="urgent"]').or(page.getByText(/^urgent$/i));
      if (await urgentEl.isVisible({ timeout: 1000 }).catch(() => false)) {
        await urgentEl.first().click();
        console.log('  Clicked urgent element');
      } else {
        console.log('  WARNING: Priority control not found');
      }
    }
  }

  await screenshot(page, '09-new-task-filled');

  // Submit the form
  console.log('  Submitting the new task...');
  const submitBtn = page.getByRole('button', { name: /create task|save|add task|submit/i });
  const submitVisible = await submitBtn.isVisible({ timeout: 2000 }).catch(() => false);
  if (submitVisible) {
    await submitBtn.first().click();
  } else {
    // Try Enter
    await page.keyboard.press('Enter');
  }
  await page.waitForTimeout(1500);

  // ─── Step 10: Screenshot after task creation ───────────────────────────────
  console.log('Step 10: Screenshot after task creation...');
  await screenshot(page, '10-after-task-created');

  const bugFixTask = page.getByText('Bug fix', { exact: false });
  const bugFixVisible = await bugFixTask.isVisible({ timeout: 3000 }).catch(() => false);
  console.log(`  "Bug fix" task visible on board: ${bugFixVisible}`);

  // ─── Step 11: Navigate to Settings ────────────────────────────────────────
  console.log('Step 11: Navigating to Settings...');
  const settingsLink = page.getByRole('link', { name: /settings/i })
    .or(page.getByRole('button', { name: /settings/i }))
    .or(page.locator('a[href*="settings"]'));

  const settingsVisible = await settingsLink.isVisible({ timeout: 3000 }).catch(() => false);
  console.log(`  Settings link visible: ${settingsVisible}`);
  if (settingsVisible) {
    await settingsLink.first().click();
    await page.waitForTimeout(1200);
  } else {
    await page.goto(`${BASE_URL}/settings`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
  }
  await screenshot(page, '11-settings-page');
  console.log('  Current URL:', page.url());

  // ─── Final: Console error report ──────────────────────────────────────────
  console.log('\n=== CONSOLE ERRORS ===');
  if (consoleErrors.length === 0) {
    console.log('  No console errors detected.');
  } else {
    consoleErrors.forEach(e => console.log(' ', e));
  }
  console.log('\n=== CONSOLE WARNINGS ===');
  if (consoleWarnings.length === 0) {
    console.log('  No console warnings detected.');
  } else {
    consoleWarnings.slice(0, 10).forEach(w => console.log(' ', w));
  }
});
