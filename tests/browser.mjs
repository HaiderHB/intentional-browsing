import { chromium, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const extension = resolve('extension');
const screenshots = resolve('test-results');
mkdirSync(screenshots, { recursive: true });
const context = await chromium.launchPersistentContext('', {
  channel: 'chromium', headless: true,
  executablePath: process.env.CHROMIUM_PATH || undefined,
  viewport: { width: 1360, height: 960 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
});
const errors = [];
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
const id = worker.url().split('/')[2];
const ui = await context.newPage();
const request = (type, extra = {}) => ui.evaluate(async ({ type, extra }) => {
  const result = await chrome.runtime.sendMessage({ type, ...extra });
  if (!result.ok) throw new Error(result.error);
  return result.data;
}, { type, extra });
const report = label => console.log(`PASS ${label}`);
try {
  // Model player shortcuts at both capture and bubble phases. Shadow-DOM
  // retargeting means a player cannot recognize the extension's input by tag.
  const shortcuts = `<script>window.playerSpacePresses=0;for(const target of [window,document])for(const capture of [true,false])for(const type of ['keydown','keypress','keyup'])target.addEventListener(type,event=>{if(event.code==='Space'&&event.target.tagName!=='INPUT'){window.playerSpacePresses++;event.preventDefault();}},capture);</script>`;
  await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><title>Fixture video site</title>${shortcuts}</head><body style="margin:0;background:#f1f2f0;font:20px Arial"><header style="padding:30px;background:white">A video website</header><main style="padding:60px"><h1>Something to watch</h1><p>This local fixture makes the test independent of the network.</p><button id="underlying">A page control</button></main></body></html>` }));
  await context.route('https://music.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>Music fixture</title>${shortcuts}<h1>Music site</h1>` }));
  await ui.goto(`chrome-extension://${id}/options.html`);
  await expect(ui.locator('#unlock-phrase')).toHaveValue('unlock now');
  await expect(ui.locator('#add-minutes')).toHaveValue('5');
  await expect(ui.locator('#max-adds')).toHaveValue('3');
  await ui.locator('#new-domain').fill('https://www.youtube.com/watch?v=example');
  await ui.locator('#new-session').fill('15'); await ui.locator('#new-daily').fill('1');
  await ui.locator('#add').click(); await ui.locator('#save').click();
  await expect(ui.locator('#status')).toContainText('Saved');
  await ui.screenshot({ path: resolve(screenshots, 'settings.png'), fullPage: true });
  report('settings persist normalized domains and custom limits');
  await ui.goto(`chrome-extension://${id}/options.html#settings`);
  await expect(ui.locator('#unlock-phrase')).toHaveValue('unlock now');
  const rejectedFromUi = await ui.evaluate(() => chrome.runtime.sendMessage({ type: 'ADD_TIME' }));
  assert.equal(rejectedFromUi.ok, false, 'Extension pages must not impersonate a website tab');
  await expect(ui.locator('.domain')).toHaveText('youtube.com');
  assert.equal((await request('DASHBOARD')).sites.length, 1);
  report('settings fragments load and rejected requests do not break subsequent requests');

  const page = await context.newPage(); await page.goto('https://www.youtube.com/watch?v=fixture'); await page.bringToFront();
  await expect(page.locator('dialog')).toBeVisible();
  await expect(page.locator('#minutes')).toHaveAttribute('max', '1');
  await expect(page.locator('button[type=submit]')).toBeDisabled();
  await page.locator('#phrase').fill('not the phrase'); await expect(page.locator('button[type=submit]')).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(page.locator('dialog')).toBeVisible();
  await page.locator('#phrase').fill('');
  await page.screenshot({ path: resolve(screenshots, 'unlock.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(screenshots, 'unlock-narrow.png') });
  assert.equal(await page.locator('dialog .shell').evaluate(e => e.scrollWidth <= e.clientWidth), true);
  await page.setViewportSize({ width: 1360, height: 960 });
  report('gate, exact phrase, capped slider, Escape protection, and narrow layout');

  await page.locator('#phrase').pressSequentially('unlock now');
  await expect(page.locator('#phrase')).toHaveValue('unlock now');
  assert.equal(await page.evaluate(() => window.playerSpacePresses), 0);
  report('spaces in unlock input never reach window or document player shortcuts');
  await page.locator('button[type=submit]').click();
  await expect(page.locator('.widget')).toBeVisible(); await expect(page.locator('dialog')).not.toBeVisible();
  await expect(page.locator('.widget')).toHaveCSS('opacity', '0.5');
  await page.locator('.widget').hover();
  await expect(page.locator('.widget')).toHaveCSS('opacity', '1');
  await page.mouse.move(600, 500);
  await expect(page.locator('.widget')).toHaveCSS('opacity', '0.5');
  await expect(page.locator('.widget-time #session')).toContainText(':');
  await expect(page.locator('.widget-usage')).toContainText('/ 1 min today');
  await page.locator('#underlying').focus(); await page.keyboard.press('Space');
  assert.ok(await page.evaluate(() => window.playerSpacePresses > 0), 'Normal player keyboard shortcuts still work');
  await expect.poll(async () => (await request('DASHBOARD')).sites[0].usedMs, { timeout: 10000 }).toBeGreaterThan(1000);
  await page.screenshot({ path: resolve(screenshots, 'widget.png') });
  // Pointer dragging snaps to all four corners and persists across reloads.
  for (const [corner, x, y] of [['bottom-left', 100, 800], ['bottom-right', 1200, 800], ['top-left', 100, 100], ['top-right', 1200, 100]]) {
    const handle = await page.locator('#move-widget').boundingBox();
    await page.mouse.move(handle.x + 30, handle.y + 10); await page.mouse.down();
    await page.mouse.move(x, y, { steps: 6 }); await page.mouse.up();
    await expect(page.locator('.widget')).toHaveAttribute('data-corner', corner);
    await expect.poll(async () => (await request('DASHBOARD')).settings.widgetCorner).toBe(corner);
  }
  await page.locator('#move-widget').focus(); await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.widget')).toHaveAttribute('data-corner', 'top-left');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.widget')).toHaveAttribute('data-corner', 'bottom-left');
  await page.reload(); await expect(page.locator('.widget')).toHaveAttribute('data-corner', 'bottom-left');
  await page.setViewportSize({ width: 320, height: 480 });
  const rect = await page.locator('.widget').boundingBox();
  assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 320 && rect.y + rect.height <= 480);
  await page.setViewportSize({ width: 1360, height: 960 });
  report('hover opacity, all four drag corners, keyboard positioning, persistence, and narrow bounds');
  const first = (await request('DASHBOARD')).sites[0];
  await page.reload(); await expect(page.locator('.widget')).toBeVisible();
  assert.equal((await request('DASHBOARD')).sites[0].expiresAt, first.expiresAt);
  report('unlock, active usage widget, and reload preserving the original session');

  const music = await context.newPage(); await music.goto('https://music.youtube.com/'); await music.bringToFront();
  await expect(music.locator('.widget')).toBeVisible();
  assert.equal((await request('DASHBOARD')).sites[0].expiresAt, first.expiresAt);
  const before = (await request('DASHBOARD')).sites[0].usedMs;
  await new Promise(r => setTimeout(r, 2500));
  const after = (await request('DASHBOARD')).sites[0].usedMs;
  assert.ok(after - before < 3500, 'Two tabs must not double count');
  report('subdomains share session and usage is not double counted');
  await ui.bringToFront();
  const paused = (await request('DASHBOARD')).sites[0].usedMs;
  await new Promise(r => setTimeout(r, 2200));
  assert.ok((await request('DASHBOARD')).sites[0].usedMs - paused < 300, 'Background tabs must not count');
  report('background tabs pause daily usage');

  await music.bringToFront(); await music.locator('#end').click();
  await expect(music.locator('dialog')).toBeVisible(); await expect(page.locator('dialog')).toBeVisible();
  report('ending a session relocks all tabs');

  // Shift the worker clock, then use real content-script heartbeats. No production test hooks.
  await worker.evaluate(() => { globalThis.testRealNow = Date.now; globalThis.testOffset = 0; Date.now = () => globalThis.testRealNow() + globalThis.testOffset; });
  await music.locator('#phrase').pressSequentially('unlock now'); await music.locator('button[type=submit]').click();
  await expect(music.locator('.widget')).toBeVisible();
  await worker.evaluate(() => { globalThis.testOffset += 61000; });
  await expect(music.locator('dialog')).toBeVisible({ timeout: 5000 });
  assert.equal((await request('DASHBOARD')).sites[0].mode, 'gate');
  report('session expiration locks the website even without navigation');
  // Charge in short increments while a real foreground heartbeat is present.
  await music.locator('#phrase').pressSequentially('unlock now');
  await expect(music.locator('#phrase')).toHaveValue('unlock now');
  assert.equal(await music.evaluate(() => window.playerSpacePresses), 0);
  await music.locator('button[type=submit]').click();
  report('spaces remain isolated when unlocking again after timer expiration');
  await expect(music.locator('.widget')).toBeVisible();
  for (let i = 0; i < 24; i++) {
    await worker.evaluate(() => { globalThis.testOffset += 2500; });
    await music.evaluate(() => window.dispatchEvent(new Event('focus')));
    await new Promise(r => setTimeout(r, 160));
    if ((await request('DASHBOARD')).sites[0].mode === 'blocked') break;
  }
  await expect(music.locator('dialog h1')).toContainText('You kept your limit', { timeout: 5000 });
  await expect(music.locator('#minutes')).toHaveCount(0);
  assert.equal((await request('DASHBOARD')).sites[0].usedMs, 60000);
  await music.reload(); await expect(music.locator('dialog h1')).toContainText('You kept your limit');
  await music.screenshot({ path: resolve(screenshots, 'blocked.png') });
  report('hard daily cap has no slider and survives reload');
  const blockedSettings = (await request('DASHBOARD')).settings;
  await ui.getByRole('button', { name: 'Remove youtube.com', exact: true }).click();
  await expect(music.locator('intentional-focus')).toHaveCount(0);
  await expect(page.locator('intentional-focus')).toHaveCount(0);
  await request('SAVE_SETTINGS', { settings: blockedSettings });
  await expect(music.locator('dialog h1')).toContainText('You kept your limit');
  report('removing a daily-blocked website immediately removes the block; re-adding preserves daily usage');

  const dashboard = await request('DASHBOARD');
  await worker.evaluate(resetAt => { globalThis.testOffset = resetAt - globalThis.testRealNow() + 1; }, dashboard.resetAt);
  await music.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(music.locator('#minutes')).toBeVisible({ timeout: 5000 });
  assert.equal((await request('DASHBOARD')).sites[0].usedMs, 0);
  report('daily boundary unlocks a fresh allowance and requires a new phrase');
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`);
  await expect(popup.locator('.domain')).toHaveText('youtube.com');
  await popup.screenshot({ path: resolve(screenshots, 'popup.png') });
  assert.deepEqual(errors, []);
  report('popup and no uncaught page errors');
  // Capture the normal 15-minute / 60-minute setup for the README.
  await worker.evaluate(() => { Date.now = globalThis.testRealNow; });
  const normal = (await request('DASHBOARD')).settings;
  normal.sites[0].dailyLimitMinutes = 60;
  await request('SAVE_SETTINGS', { settings: normal });
  await ui.reload(); await expect(ui.locator('.domain')).toHaveText('youtube.com');
  await ui.screenshot({ path: resolve(screenshots, 'settings.png'), fullPage: true });
  await page.bringToFront(); await expect(page.locator('#minutes')).toBeVisible();
  await page.screenshot({ path: resolve(screenshots, 'unlock.png') });
  await ui.locator('#add-minutes').fill('2'); await ui.locator('#max-adds').fill('2');
  await ui.locator('#save').click(); await expect(ui.locator('#status')).toContainText('Saved');
  await ui.reload(); await expect(ui.locator('#add-minutes')).toHaveValue('2');
  await expect(ui.locator('#max-adds')).toHaveValue('2');
  await page.bringToFront(); await page.locator('#phrase').pressSequentially('unlock now');
  await page.locator('button[type=submit]').click(); await expect(page.locator('#add-time')).toBeEnabled();
  const beforeAdd = (await request('DASHBOARD')).sites[0];
  await page.locator('#add-time').click();
  await expect(page.locator('#adds-left')).toContainText('1 extra-time');
  const afterAdd = (await request('DASHBOARD')).sites[0];
  assert.equal(afterAdd.expiresAt - beforeAdd.expiresAt, 120000);
  assert.equal(afterAdd.site.dailyLimitMinutes, 60);
  assert.ok(afterAdd.usedMs - beforeAdd.usedMs < 1500, 'Adding countdown time does not charge daily usage');
  await music.bringToFront(); await expect(music.locator('#adds-left')).toContainText('1 extra-time');
  await music.locator('#add-time').focus(); await music.keyboard.press('Space');
  await expect(music.locator('#add-time')).toBeDisabled();
  await expect(page.locator('#adds-left')).toContainText('0 extra-time');
  await page.reload(); await expect(page.locator('#add-time')).toBeDisabled();
  const afterSecond = (await request('DASHBOARD')).sites[0];
  assert.equal(afterSecond.expiresAt - afterAdd.expiresAt, 120000);
  report('configurable + time changes only countdown, shares quota across tabs, survives reload, and works by keyboard');
  await page.bringToFront();
  await page.screenshot({ path: resolve(screenshots, 'widget.png') });

  await ui.reload();
  await expect(ui.locator('#warn-before-end')).not.toBeChecked();
  await ui.emulateMedia({ colorScheme: 'dark' });
  await expect(ui.locator('html')).toHaveCSS('color-scheme', 'dark');
  await ui.locator('#theme').selectOption('light');
  await expect(ui.locator('html')).toHaveCSS('color-scheme', 'light');
  await ui.locator('#theme').selectOption('dark');
  await ui.locator('#warn-before-end').check(); await ui.locator('#max-adds').fill('3');
  await ui.locator('#save').click(); await expect(ui.locator('#status')).toContainText('Saved');
  await ui.screenshot({ path: resolve(screenshots, 'settings-dark.png'), fullPage: true });
  await expect(page.locator('intentional-focus')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('dialog')).toHaveCSS('background-color', 'rgb(23, 28, 25)');
  await popup.reload(); await expect(popup.locator('html')).toHaveCSS('color-scheme', 'dark');
  await page.bringToFront(); await page.screenshot({ path: resolve(screenshots, 'unlock-dark.png') });
  await page.locator('#minutes').fill('1');
  await page.locator('#phrase').pressSequentially('unlock now'); await page.locator('button[type=submit]').click();
  await expect(page.locator('.widget')).toHaveCSS('background-color', 'rgb(34, 41, 35)');
  await expect(page.locator('.warning')).toBeHidden();
  const expires = (await request('DASHBOARD')).sites[0].expiresAt;
  await worker.evaluate(expiresAt => { globalThis.testOffset = expiresAt - globalThis.testRealNow() - 12000; Date.now = () => globalThis.testRealNow() + globalThis.testOffset; }, expires);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.warning')).toBeHidden();
  await worker.evaluate(() => { globalThis.testOffset += 4000; });
  await expect(page.locator('.warning')).toBeVisible();
  await expect(page.locator('#warning-add')).toBeEnabled();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.warning')).toHaveCSS('animation-name', 'none');
  await page.screenshot({ path: resolve(screenshots, 'warning-dark.png') });
  const beforeWarningAdd = (await request('DASHBOARD')).sites[0];
  await page.locator('#warning-add').click(); await expect(page.locator('.warning')).toBeHidden();
  const extended = (await request('DASHBOARD')).sites[0];
  assert.equal(extended.expiresAt - beforeWarningAdd.expiresAt, 120000);
  assert.equal(extended.site.dailyLimitMinutes, 60);
  await worker.evaluate(expiresAt => { globalThis.testOffset = expiresAt - globalThis.testRealNow() - 8000; }, extended.expiresAt);
  await expect(page.locator('.warning')).toBeVisible(); await expect(page.locator('#warning-add')).toBeHidden();
  await worker.evaluate(() => { globalThis.testOffset += 10000; });
  await expect(page.locator('dialog')).toBeVisible(); await expect(page.locator('.warning')).toBeHidden();
  report('system/light/dark themes and optional ten-second warning, extension, quota exhaustion, reduced motion and expiry');

  // Removal must take effect on open gated and subdomain tabs without Save or reload.
  await ui.getByRole('button', { name: 'Remove youtube.com', exact: true }).click();
  await expect(ui.locator('#status')).toContainText('Restrictions are off now');
  await expect(page.locator('intentional-focus')).toHaveCount(0);
  await expect(music.locator('intentional-focus')).toHaveCount(0);
  await page.locator('#underlying').click(); // The modal must no longer make the page inert.
  assert.equal((await request('DASHBOARD')).sites.length, 0);
  const pauses = await page.evaluate(() => {
    const video = document.createElement('video'); let pauses = 0;
    video.pause = () => { pauses++; }; document.body.append(video);
    video.dispatchEvent(new Event('play')); video.remove(); return pauses;
  });
  assert.equal(pauses, 0, 'Removed websites no longer have media paused');
  // Re-add without reloading the website, then remove while its timer is visible.
  await ui.locator('#new-domain').fill('youtube.com'); await ui.locator('#new-daily').fill('60');
  await ui.locator('#add').click(); await ui.locator('#save').click();
  await expect(page.locator('dialog')).toBeVisible();
  await page.bringToFront(); await page.locator('#phrase').pressSequentially('unlock now');
  await page.locator('button[type=submit]').click(); await expect(page.locator('.widget')).toBeVisible();
  await ui.getByRole('button', { name: 'Remove youtube.com', exact: true }).click();
  await expect(page.locator('intentional-focus')).toHaveCount(0);
  await page.reload(); await expect(page.locator('intentional-focus')).toHaveCount(0);
  report('immediate removal clears gates, timers, media interception and subdomain tabs; re-adding works without reload');
  assert.deepEqual(errors, []);
} finally { await context.close(); }
await import('./persistence.mjs');
