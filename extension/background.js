import { defaults, validateSettings, freshLedger, advance, findSite, siteStatus, unlock, addTime, dayWindow, WIDGET_CORNERS } from './core.js';
import { createSerialQueue, createRequestListener, isExtensionUi } from './messaging.js';

let state;
const serial = createSerialQueue();
const event = job => { void serial(job).catch(error => console.error('Intentional background event failed:', error)); };
async function load() {
  if (state) return;
  const [local, session] = await Promise.all([chrome.storage.local.get(['settings', 'ledger']), chrome.storage.session.get('runtime')]);
  const settings = validateSettings({ ...defaults(), ...local.settings });
  state = { settings, ledger: local.ledger || freshLedger(Date.now(), settings), runtime: session.runtime || { sessions: {}, tracker: null } };
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  advance(state, Date.now());
}
async function save() {
  await Promise.all([chrome.storage.local.set({ settings: state.settings, ledger: state.ledger }), chrome.storage.session.set({ runtime: state.runtime })]);
}
async function schedule() {
  const now = Date.now();
  const next = Math.min(dayWindow(now, state.settings.resetTime).end,
    ...Object.values(state.runtime.sessions).map(s => s.expiresAt));
  await chrome.alarms.create('boundary', { when: Math.max(now + 100, next) });
}
async function broadcast() {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.filter(t => t.id && /^https?:/.test(t.url || '')).map(t => chrome.tabs.sendMessage(t.id, { type: 'REFRESH' })));
}
async function handle(message, sender) {
  await load();
  const now = Date.now();
  advance(state, now);
  let result;
  const ui = isExtensionUi(sender, chrome.runtime.id);
  if (message.type === 'DASHBOARD' && ui) {
    result = { settings: state.settings, sites: state.settings.sites.map(site => siteStatus(state, site, now)), resetAt: dayWindow(now, state.settings.resetTime).end };
  } else if (message.type === 'SAVE_SETTINGS' && ui) {
    const next = validateSettings(message.settings);
    // Editing the reset time never grants a fresh allowance immediately.
    state.ledger.start = dayWindow(now, next.resetTime).start;
    state.settings = next;
    state.runtime = { sessions: {}, tracker: null };
    advance(state, now);
    result = { settings: next };
    await schedule();
  } else if (message.type === 'REMOVE_SITE' && ui) {
    state.settings.sites = state.settings.sites.filter(site => site.domain !== message.domain);
    advance(state, now); // Drops only this website's session and active tracker.
    result = { settings: state.settings };
    await schedule();
  } else if (message.type === 'OPEN_SETTINGS') {
    await chrome.runtime.openOptionsPage(); result = {};
  } else if (message.type === 'CLOSE_TAB' && sender.tab) {
    await chrome.tabs.remove(sender.tab.id); result = {};
  } else if (!ui && sender.tab && sender.frameId === 0 && /^https?:/.test(sender.url || '') && ['STATUS', 'UNLOCK', 'ADD_TIME', 'END_SESSION', 'SET_WIDGET_CORNER'].includes(message.type)) {
    const tab = await chrome.tabs.get(sender.tab.id);
    const site = findSite(state.settings, sender.url);
    // Reject a stale document after navigation.
    if (site?.domain !== findSite(state.settings, tab.url)?.domain) throw new Error('The page changed. Reload to continue.');
    if (!site) {
      // A removed website is unrestricted, including requests already in flight.
      result = { mode: 'unmanaged' };
    } else if (message.type === 'SET_WIDGET_CORNER') {
      if (!WIDGET_CORNERS.includes(message.corner)) throw new Error('Choose a valid widget corner.');
      state.settings.widgetCorner = message.corner;
      result = siteStatus(state, site, now);
    } else if (message.type === 'UNLOCK') {
      result = unlock(state, site, message.minutes, message.phrase, now);
      await schedule();
    } else if (message.type === 'ADD_TIME') {
      result = addTime(state, site, now);
      await schedule();
    } else {
      if (message.type === 'END_SESSION' && site) {
        delete state.runtime.sessions[site.domain];
        if (state.runtime.tracker?.domain === site.domain) state.runtime.tracker = null;
      }
      result = siteStatus(state, site, now);
    }
    const window = await chrome.windows.get(tab.windowId);
    if (tab.active && window.focused && message.visible === true && result.mode === 'open') {
      state.runtime.tracker = { domain: site.domain, tabId: tab.id, at: now };
    } else if (state.runtime.tracker?.tabId === tab.id) state.runtime.tracker = null;
  } else throw new Error('This request is not allowed from this page. Reload Intentional and the website, then try again.');
  await save();
  if (['SAVE_SETTINGS', 'REMOVE_SITE', 'END_SESSION', 'UNLOCK', 'ADD_TIME', 'SET_WIDGET_CORNER'].includes(message.type)) void broadcast();
  return result;
}
chrome.runtime.onMessage.addListener(createRequestListener({ extensionId: chrome.runtime.id, enqueue: serial, handle }));
async function stopTracking() { await load(); advance(state, Date.now()); state.runtime.tracker = null; await save(); }
chrome.tabs.onActivated.addListener(() => event(stopTracking));
chrome.windows.onFocusChanged.addListener(() => event(stopTracking));
chrome.tabs.onRemoved.addListener(id => event(async () => { await load(); if (state.runtime.tracker?.tabId === id) await stopTracking(); }));
chrome.tabs.onUpdated.addListener((id, change) => {
  if (change.url) event(async () => { await load(); if (state.runtime.tracker?.tabId === id) await stopTracking(); });
});
chrome.alarms.onAlarm.addListener(() => event(async () => { await load(); advance(state, Date.now()); await save(); await schedule(); void broadcast(); }));
chrome.runtime.onStartup.addListener(() => event(async () => { await load(); state.runtime = { sessions: {}, tracker: null }; await save(); await schedule(); }));
chrome.runtime.onInstalled.addListener(() => event(async () => { await load(); await save(); await schedule(); void broadcast(); }));
