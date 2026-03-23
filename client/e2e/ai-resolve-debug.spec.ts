import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const SCREENSHOTS_DIR = path.join(process.cwd(), 'client', 'e2e', 'screenshots');
const BASE_URL = 'http://localhost:5173';

if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

function ss(page: any, name: string) {
  const p = path.join(SCREENSHOTS_DIR, `ar-${name}.png`);
  console.log(`Screenshot: ar-${name}.png`);
  return page.screenshot({ path: p, fullPage: false });
}

interface WsFrame { dir: 'out' | 'in'; data: string; t: number; }

// Injects WS interceptor into current page context
async function injectWsInterceptor(page: any) {
  await page.evaluate(() => {
    (window as any).__wsFrames = (window as any).__wsFrames || [];
    (window as any).__wsInstances = (window as any).__wsInstances || [];
    if ((window as any).__wsPatched) return; // don't double-patch
    (window as any).__wsPatched = true;
    const Orig = window.WebSocket;
    class Patched extends Orig {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        const u = typeof url === 'string' ? url : url.toString();
        if (!u.includes('/ws/terminal')) return;
        const frames: any[] = (window as any).__wsFrames;
        (window as any).__wsInstances.push({ url: u, t: Date.now() });
        const orig = this.send.bind(this);
        this.send = (d: any) => {
          frames.push({ dir: 'out', data: typeof d === 'string' ? d : '[bin]', t: Date.now() });
          orig(d);
        };
        this.addEventListener('open', () => frames.push({ dir: 'in', data: '[OPEN]', t: Date.now() }));
        this.addEventListener('close', (e: CloseEvent) => frames.push({ dir: 'in', data: `[CLOSE ${e.code}]`, t: Date.now() }));
        this.addEventListener('error', () => frames.push({ dir: 'in', data: '[ERROR]', t: Date.now() }));
        this.addEventListener('message', (e: MessageEvent) => frames.push({ dir: 'in', data: e.data, t: Date.now() }));
      }
    }
    window.WebSocket = Patched as any;
  });
}

test.describe('AI Resolve - Full Diagnostic', () => {
  test('click AI Resolve and trace WS messages + terminal output', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg: any) => {
      if (msg.type() === 'error') consoleErrors.push(`[${msg.type()}] ${msg.text()}`);
    });
    page.on('pageerror', (err: any) => consoleErrors.push(`[pageerror] ${err.message}`));

    // === STEP 1: Load app ===
    console.log('\n=== STEP 1: Load app ===');
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await ss(page, '01-base');
    console.log('URL:', page.url(), '| Title:', await page.title());

    // Dismiss onboarding wizard (3 steps: Welcome -> Find Projects -> Ready)
    const getStartedBtn = page.getByRole('button', { name: /get started/i });
    if (await getStartedBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('Dismissing onboarding...');
      await getStartedBtn.click();
      await page.waitForTimeout(800);

      const skipBtn = page.getByRole('button', { name: /skip/i });
      if (await skipBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await skipBtn.click();
        await page.waitForTimeout(800);
      }

      const startBtn = page.getByRole('button', { name: /start using vibe kanban/i });
      if (await startBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await startBtn.click();
        await page.waitForTimeout(1000);
      }
      console.log('Onboarding dismissed');
    }

    await ss(page, '02-dashboard');

    // Inject WS interceptor (SPA — no page navigation happens, so this survives)
    await injectWsInterceptor(page);
    console.log('WS interceptor injected');

    // === STEP 2: Navigate to Test Project via sidebar or card ===
    console.log('\n=== STEP 2: Navigate to Test Project ===');

    // Try sidebar link first
    const sidebarLink = page.locator('a, button, [role="button"]').filter({ hasText: /^Test Project$/ });
    const sidebarCount = await sidebarLink.count();
    console.log('Sidebar "Test Project" links:', sidebarCount);

    // Dump all links/buttons to understand structure
    const allLinks = await page.locator('a, [role="button"]').allInnerTexts();
    console.log('All links/buttons:', allLinks.slice(0, 20).map((t: string) => t.trim()).filter(Boolean));

    // Try clicking any "Test Project" element
    const testProjectEls = page.getByText('Test Project', { exact: true });
    const testProjectCount = await testProjectEls.count();
    console.log('"Test Project" exact matches:', testProjectCount);

    if (testProjectCount > 0) {
      // Check each one's tag/role
      for (let i = 0; i < Math.min(testProjectCount, 5); i++) {
        const el = testProjectEls.nth(i);
        const tag = await el.evaluate((e: Element) => e.tagName);
        const visible = await el.isVisible();
        console.log(`  Match ${i}: <${tag}> visible=${visible}`);
      }

      // Click the first visible one
      await testProjectEls.first().click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);
    } else {
      // Try sidebar item by text content
      const sidebarItem = page.locator('nav a, aside a, [class*="sidebar"] a').filter({ hasText: /Test Project/i });
      if (await sidebarItem.count() > 0) {
        await sidebarItem.first().click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000);
      }
    }

    await ss(page, '03-project');
    console.log('URL after nav:', page.url());
    const bodyText = await page.locator('body').innerText();
    console.log('Body text (first 600):\n', bodyText.substring(0, 600));

    // === STEP 3: Find task cards ===
    console.log('\n=== STEP 3: Find task cards ===');

    // Wait for the board to populate
    await page.waitForFunction(() => {
      const body = document.body.innerText;
      return body.includes('Bug fix') || body.includes('Test kanban task') || body.includes('Backlog');
    }, { timeout: 10000 }).catch(() => console.log('Task wait timed out'));

    const bugFixCount = await page.getByText('Bug fix', { exact: false }).count();
    const testTaskCount = await page.getByText('Test kanban task', { exact: false }).count();
    console.log('"Bug fix":', bugFixCount, '"Test kanban task":', testTaskCount);

    if (bugFixCount === 0 && testTaskCount === 0) {
      await ss(page, '03b-no-tasks');
      const allText = await page.evaluate(() => document.body.innerText);
      console.log('Full body text:\n', allText.substring(0, 1000));
      throw new Error('No task cards found');
    }

    const useTask = bugFixCount > 0 ? 'Bug fix' : 'Test kanban task';
    const taskEl = page.getByText(useTask, { exact: false }).first();
    console.log('Target task:', useTask);

    // === STEP 4: Hover ===
    console.log('\n=== STEP 4: Hover over task ===');
    await taskEl.scrollIntoViewIfNeeded();
    await taskEl.hover({ force: true });
    await page.waitForTimeout(800);
    await ss(page, '04-hovered');

    const visButtons = await page.locator('button:visible').allInnerTexts();
    console.log('Visible buttons after hover:', visButtons.filter(Boolean).map((b: string) => b.trim()));

    // === STEP 5: Find AI Resolve button ===
    console.log('\n=== STEP 5: AI Resolve button ===');
    let aiBtn = page.getByRole('button', { name: /AI Resolve/i });
    let aiCount = await aiBtn.count();
    console.log('AI Resolve button count:', aiCount);

    if (aiCount === 0) {
      // Maybe the button is in a task card that needs to be found differently
      // Try looking for a Zap icon button near the task text
      await taskEl.hover({ force: true });
      await page.waitForTimeout(500);

      // Look for button with "AI Resolve" text anywhere in DOM (including hidden)
      const anyAiBtn = page.locator('button').filter({ hasText: /AI Resolve/i });
      console.log('Any AI Resolve button (visible or not):', await anyAiBtn.count());

      // Try clicking the task to open its dialog
      await taskEl.click();
      await page.waitForTimeout(1200);
      await ss(page, '05-task-clicked');

      aiBtn = page.getByRole('button', { name: /AI Resolve/i });
      aiCount = await aiBtn.count();
      console.log('AI Resolve after task click:', aiCount);

      if (aiCount === 0) {
        const allBtnTexts = await page.locator('button').allInnerTexts();
        console.log('All buttons:', allBtnTexts.map((t: string) => t.trim()).filter(Boolean));
        throw new Error('AI Resolve button not found');
      }
    }

    // === STEP 6: CLICK AI RESOLVE ===
    console.log('\n=== STEP 6: CLICK AI RESOLVE ===');
    const t0 = Date.now();

    await taskEl.hover({ force: true });
    await page.waitForTimeout(200);
    await aiBtn.first().click({ force: true });
    console.log('Clicked T=0');
    await ss(page, '06-clicked');

    // Poll WS frames every 500ms for 7 seconds
    let prevCount = 0;
    for (let tick = 1; tick <= 14; tick++) {
      await page.waitForTimeout(500);
      const elapsed = Date.now() - t0;
      const snap = JSON.parse(await page.evaluate(() => JSON.stringify({
        frames: (window as any).__wsFrames || [],
        instances: (window as any).__wsInstances || [],
      })));

      const newFrames: WsFrame[] = snap.frames.slice(prevCount);
      prevCount = snap.frames.length;

      if (newFrames.length > 0 || tick <= 2 || tick === 4 || tick === 6 || tick === 14) {
        console.log(`\n--- T+${elapsed}ms (tick ${tick}) ---`);
        if (tick === 1) console.log('  WS instances:', snap.instances.length, snap.instances.map((i: any) => `+${i.t - t0}ms`));
        if (newFrames.length === 0) {
          console.log('  (no new frames)');
        } else {
          newFrames.forEach((f: WsFrame, i: number) => {
            const idx = prevCount - newFrames.length + i;
            console.log(`  [${idx}] ${f.dir} +${f.t - t0}ms: ${f.data.substring(0, 250)}`);
          });
        }
      }

      if (tick === 2) await ss(page, '07-1sec');
      if (tick === 5) await ss(page, '08-2500ms');
      if (tick === 10) await ss(page, '09-5sec');
      if (tick === 14) await ss(page, '10-7sec');
    }

    // Final dump
    const final = JSON.parse(await page.evaluate(() => JSON.stringify({
      frames: (window as any).__wsFrames || [],
      instances: (window as any).__wsInstances || [],
    })));
    const frames: WsFrame[] = final.frames;
    const instances: any[] = final.instances;

    console.log('\n========== FINAL ANALYSIS ==========');
    console.log(`WS connections: ${instances.length}`);
    instances.forEach((inst, i) => console.log(`  WS[${i}] +${inst.t - t0}ms`));
    console.log(`Total frames: ${frames.length}`);
    frames.forEach((f, i) => {
      console.log(`  [${i}] ${f.dir.padEnd(3)} +${f.t - t0}ms: ${f.data.substring(0, 250)}`);
    });

    const createMsg = frames.filter(f => f.dir === 'out').find(f => {
      try { return JSON.parse(f.data).type === 'create'; } catch { return false; }
    });
    const createParsed = createMsg ? JSON.parse(createMsg.data) : null;
    const openCount = frames.filter(f => f.data === '[OPEN]').length;
    const closeFrames = frames.filter(f => f.data.includes('[CLOSE'));
    const outputFrames = frames.filter(f => {
      try { return JSON.parse(f.data).type === 'output'; } catch { return false; }
    });

    console.log('\n--- KEY METRICS ---');
    console.log('WS OPEN:', openCount);
    console.log('WS CLOSE:', closeFrames.length, closeFrames.map(f => `${f.data}@+${f.t - t0}ms`));
    console.log('Output frames:', outputFrames.length);
    console.log('create sent:', !!createMsg, createMsg ? `@+${createMsg.t - t0}ms` : 'NEVER');
    if (createParsed) {
      console.log('  sessionType:', createParsed.sessionType);
      console.log('  prompt present:', !!createParsed.prompt, 'length:', createParsed.prompt?.length ?? 0);
    }

    // Diagnosis
    console.log('\n--- ROOT CAUSE ---');
    if (!createMsg) {
      console.log('BUG: create message never sent (WS not ready)');
    } else if (closeFrames.length > 0) {
      const closeTime = closeFrames[0].t;
      const timeSinceCreate = closeTime - createMsg.t;
      console.log(`WS closed ${timeSinceCreate}ms after create was sent`);
      if (timeSinceCreate < 2000) {
        console.log('BUG CONFIRMED: WS closed before server 2s setTimeout fired');
        console.log('  Server onclose kills all sessions => launchAiResolve finds session gone => no command written');
      }
    } else if (outputFrames.length === 0) {
      console.log('BUG: create sent, WS open, but no output - server crashed writing PTY (ptyProcess.write threw)');
    } else {
      const combined = outputFrames.map((f: WsFrame) => {
        try { return JSON.parse(f.data).data; } catch { return ''; }
      }).join('');
      console.log('WORKING: output received!\n', combined.substring(0, 800));
    }

    if (consoleErrors.length) console.log('\nBROWSER ERRORS:', consoleErrors);

    expect(createMsg, 'create WS message must be sent').toBeTruthy();
    expect(createParsed?.prompt, 'create message must include prompt').toBeTruthy();
  });
});
