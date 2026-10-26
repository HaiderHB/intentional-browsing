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
  await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><title>Fixture video site</title></head><body style="margin:0;background:#f1f2f0;font:20px Arial"><header style="padding:30px;background:white">A video website</header><main style="padding:60px"><h1>Something to watch</h1><p>This local fixture makes the test independent of the network.</p><button id="underlying">A page control</button></main></body></html>' }));
  await context.route('https://music.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Music fixture</title><h1>Music site</h1>' }));
  await ui.goto(`chrome-extension://${id}/options.html`);
  await expect(ui.locator('#unlock-phrase')).toHaveValue('unlock now');
  await ui.locator('#new-domain').fill('https://www.youtube.com/watch?v=example');
  await ui.locator('#new-session').fill('15'); await ui.locator('#new-daily').fill('1');
  await ui.locator('#add').click(); await ui.locator('#save').click();
  await expect(ui.locator('#status')).toContainText('Saved');
  await ui.screenshot({ path: resolve(screenshots, 'settings.png'), fullPage: true });
  report('settings persist normalized domains and custom limits');

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
  await page.locator('button[type=submit]').click();
  await expect(page.locator('.widget')).toBeVisible(); await expect(page.locator('dialog')).not.toBeVisible();
  await expect.poll(async () => (await request('DASHBOARD')).sites[0].usedMs, { timeout: 10000 }).toBeGreaterThan(1000);
  await page.screenshot({ path: resolve(screenshots, 'widget.png') });
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
  await music.locator('#phrase').pressSequentially('unlock now'); await music.locator('button[type=submit]').click();
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
} finally { await context.close(); }
await import('./persistence.mjs');
