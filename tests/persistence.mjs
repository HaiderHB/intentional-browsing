import { chromium, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { mkdtempSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

mkdirSync('test-results', { recursive: true });
const profile = mkdtempSync(resolve('test-results', 'profile-'));
const extension = resolve('extension');
async function launch() {
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, executablePath: process.env.CHROMIUM_PATH || undefined,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  await context.route('https://example.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Persistence fixture</title><h1>Test site</h1>' }));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const ui = await context.newPage(); await ui.goto(`chrome-extension://${worker.url().split('/')[2]}/options.html`);
  await expect(ui.locator('#unlock-phrase')).toHaveValue('unlock now');
  const request = (type, extra = {}) => ui.evaluate(({ type, extra }) => chrome.runtime.sendMessage({ type, ...extra }), { type, extra });
  return { context, ui, request };
}
let browser = await launch(), before;
try {
  await browser.request('SAVE_SETTINGS', { settings: { phrase: 'unlock now', resetTime: '03:00', sites: [{ domain: 'example.com', dailyLimitMinutes: 30, maxSessionMinutes: 15 }] } });
  const page = await browser.context.newPage(); await page.goto('https://example.com/'); await page.bringToFront();
  await page.locator('#phrase').pressSequentially('unlock now'); await page.locator('button[type=submit]').click();
  await page.locator('#add-time').click();
  await expect(page.locator('#adds-left')).toContainText('2 extra-time');
  await expect.poll(async () => (await browser.request('DASHBOARD')).data.sites[0].usedMs).toBeGreaterThan(1000);
  before = (await browser.request('DASHBOARD')).data.sites[0].usedMs;
} finally { await browser.context.close(); }
browser = await launch();
try {
  const { data } = await browser.request('DASHBOARD');
  assert.equal(data.sites[0].mode, 'gate');
  assert.ok(data.sites[0].usedMs >= before);
  assert.equal(data.sites[0].addsRemaining, 2);
  const page = await browser.context.newPage(); await page.goto('https://example.com/');
  await expect(page.locator('#minutes')).toBeVisible();
  console.log('PASS browser restart preserves usage and extra-time quota and ends the previous session');
} finally { await browser.context.close(); }
