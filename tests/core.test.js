import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults, normalizeDomain, findSite, validateSettings, dayWindow, freshLedger, advance, unlock, siteStatus, MINUTE } from '../extension/core.js';
const base = new Date(2026, 9, 26, 12).getTime();
function fixture(now = base) {
  const settings = { ...defaults(), sites: [{ domain: 'youtube.com', maxSessionMinutes: 15, dailyLimitMinutes: 30 }] };
  return { settings, ledger: freshLedger(now, settings), runtime: { sessions: {}, tracker: null } };
}
test('normalizes URLs and covers only the domain and real subdomains', () => {
  assert.equal(normalizeDomain(' https://WWW.YouTube.com/watch?v=test '), 'youtube.com');
  assert.equal(normalizeDomain('youtube.com.'), 'youtube.com');
  const { settings } = fixture();
  assert.ok(findSite(settings, 'https://music.youtube.com/'));
  for (const url of ['https://evilyoutube.com', 'https://youtube.com.attacker.org', 'file:///youtube.com']) assert.equal(findSite(settings, url), null);
  for (const value of ['javascript:alert(1)', 'https://user:pass@example.com', '*.com', 'not a domain', 'https://-bad.com']) assert.throws(() => normalizeDomain(value));
});
test('rejects overlapping rules, invalid limits, phrases and reset times', () => {
  const { settings } = fixture();
  assert.throws(() => validateSettings({ ...settings, sites: [...settings.sites, { ...settings.sites[0], domain: 'music.youtube.com' }] }));
  for (const limit of [0, -2, 1.5, 1441, '10']) assert.throws(() => validateSettings({ ...settings, sites: [{ ...settings.sites[0], dailyLimitMinutes: limit }] }));
  assert.throws(() => validateSettings({ ...settings, phrase: '   ' }));
  assert.throws(() => validateSettings({ ...settings, resetTime: '25:00' }));
});
test('day starts at 3 AM, including exact boundary', () => {
  const before = new Date(2026, 9, 26, 2, 59, 59).getTime();
  const at = new Date(2026, 9, 26, 3).getTime();
  assert.equal(dayWindow(before, '03:00').end, at);
  assert.equal(dayWindow(at, '03:00').start, at);
});
test('DST uses calendar days in America/Toronto', () => {
  const old = process.env.TZ; process.env.TZ = 'America/Toronto';
  try {
    const spring = dayWindow(new Date(2026, 2, 7, 12).getTime(), '03:00');
    const fall = dayWindow(new Date(2026, 9, 31, 12).getTime(), '03:00');
    assert.equal(spring.end - spring.start, 23 * 60 * MINUTE);
    assert.equal(fall.end - fall.start, 25 * 60 * MINUTE);
    const missing = dayWindow(new Date(2026, 2, 8, 1).getTime(), '02:30');
    assert.equal(new Date(missing.start).getHours(), 2);
  } finally { if (old === undefined) delete process.env.TZ; else process.env.TZ = old; }
});
test('phrase and maximum enforced; concurrent unlock cannot extend grant', () => {
  const state = fixture(), site = state.settings.sites[0];
  assert.throws(() => unlock(state, site, 5, 'wrong', base));
  assert.throws(() => unlock(state, site, 16, 'unlock now', base));
  assert.throws(() => unlock(state, site, .5, 'unlock now', base));
  const first = unlock(state, site, 5, 'unlock now', base);
  const second = unlock(state, site, 15, 'unlock now', base + 1000);
  assert.equal(first.expiresAt, second.expiresAt);
});
test('usage accumulates once, survives serialization, and caps precisely', () => {
  let state = fixture(), site = state.settings.sites[0];
  unlock(state, site, 5, 'unlock now', base);
  state.runtime.tracker = { domain: site.domain, tabId: 1, at: base };
  advance(state, base + 1000); advance(state, base + 1000);
  assert.equal(state.ledger.totals[site.domain], 1000);
  state = JSON.parse(JSON.stringify(state)); advance(state, base + 2000);
  assert.equal(state.ledger.totals[site.domain], 2000);
  state.ledger.totals[site.domain] = 30 * MINUTE - 500;
  advance(state, base + 3000);
  assert.equal(state.ledger.totals[site.domain], 30 * MINUTE);
  assert.equal(siteStatus(state, site, base + 3000).mode, 'blocked');
  assert.throws(() => unlock(state, site, 1, 'unlock now', base + 3000));
});
test('no heartbeat / sleep does not charge a long gap', () => {
  const state = fixture(), site = state.settings.sites[0];
  unlock(state, site, 15, 'unlock now', base);
  state.runtime.tracker = { domain: site.domain, tabId: 1, at: base };
  advance(state, base + 8 * MINUTE);
  assert.equal(state.ledger.totals[site.domain] || 0, 0);
});
test('session expires with no foreground usage; daily usage remains', () => {
  const state = fixture(), site = state.settings.sites[0];
  state.ledger.totals[site.domain] = 10000;
  unlock(state, site, 1, 'unlock now', base);
  advance(state, base + MINUTE);
  assert.equal(siteStatus(state, site, base + MINUTE).mode, 'gate');
  assert.equal(state.ledger.totals[site.domain], 10000);
});
test('last partial minute is usable and grants cannot cross daily reset', () => {
  const state = fixture(), site = state.settings.sites[0];
  state.ledger.totals[site.domain] = 30 * MINUTE - 15000;
  const status = unlock(state, site, 1, 'unlock now', base);
  assert.equal(status.maxMinutes, 1); assert.equal(status.expiresAt, base + 15000);
  const nearReset = new Date(2026, 9, 27, 2, 59, 45).getTime();
  const other = fixture(nearReset);
  assert.equal(unlock(other, site, 10, 'unlock now', nearReset).expiresAt, nearReset + 15000);
});
test('reset clears old usage and session and returns to the gate', () => {
  const now = new Date(2026, 9, 26, 2, 59, 58).getTime(), state = fixture(now), site = state.settings.sites[0];
  unlock(state, site, 1, 'unlock now', now); state.runtime.tracker = { domain: site.domain, tabId: 1, at: now };
  advance(state, now + 3000);
  assert.equal(siteStatus(state, site, now + 3000).mode, 'gate');
  assert.deepEqual(state.ledger.totals, {});
});
test('lowering daily limit does not erase already-recorded usage', () => {
  const state = fixture(), site = state.settings.sites[0];
  unlock(state, site, 10, 'unlock now', base); state.ledger.totals[site.domain] = 10 * MINUTE;
  state.runtime.tracker = { domain: site.domain, tabId: 1, at: base }; site.dailyLimitMinutes = 5;
  advance(state, base + 1000); assert.equal(state.ledger.totals[site.domain], 10 * MINUTE);
});
