import { defaults, validateSettings, freshLedger, advance, findSite, siteStatus, unlock, dayWindow } from './core.js';

let state;
let queue = Promise.resolve();
const serial = job => { const result = queue.then(job); queue = result.catch(console.error); return result; };
async function load() {
  if (state) return;
  const [local, session] = await Promise.all([chrome.storage.local.get(['settings', 'ledger']), chrome.storage.session.get('runtime')]);
  const settings = local.settings || defaults();
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
function isUi(sender) {
  return [chrome.runtime.getURL('options.html'), chrome.runtime.getURL('popup.html')].includes(sender.url?.split('?')[0]);
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
  const ui = isUi(sender);
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
  } else if (message.type === 'OPEN_SETTINGS') {
    await chrome.runtime.openOptionsPage(); result = {};
  } else if (message.type === 'CLOSE_TAB' && sender.tab) {
    await chrome.tabs.remove(sender.tab.id); result = {};
  } else if (sender.tab && sender.frameId === 0 && ['STATUS', 'UNLOCK', 'END_SESSION'].includes(message.type)) {
    const tab = await chrome.tabs.get(sender.tab.id);
    const site = findSite(state.settings, sender.url);
    // Reject a stale document after navigation.
    if (site?.domain !== findSite(state.settings, tab.url)?.domain) throw new Error('The page changed. Reload to continue.');
    if (message.type === 'UNLOCK') {
      result = unlock(state, site, message.minutes, message.phrase, now);
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
  } else throw new Error('Unknown or unauthorized request.');
  await save();
  if (message.type === 'SAVE_SETTINGS' || message.type === 'END_SESSION' || message.type === 'UNLOCK') void broadcast();
  return result;
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  serial(() => handle(message, sender)).then(data => respond({ ok: true, data }), error => respond({ ok: false, error: error.message }));
  return true;
});
async function stopTracking() { await load(); advance(state, Date.now()); state.runtime.tracker = null; await save(); }
chrome.tabs.onActivated.addListener(() => void serial(stopTracking));
chrome.windows.onFocusChanged.addListener(() => void serial(stopTracking));
chrome.tabs.onRemoved.addListener(id => void serial(async () => { await load(); if (state.runtime.tracker?.tabId === id) await stopTracking(); }));
chrome.tabs.onUpdated.addListener((id, change) => {
  if (change.url) void serial(async () => { await load(); if (state.runtime.tracker?.tabId === id) await stopTracking(); });
});
chrome.alarms.onAlarm.addListener(() => void serial(async () => { await load(); advance(state, Date.now()); await save(); await schedule(); void broadcast(); }));
chrome.runtime.onStartup.addListener(() => void serial(async () => { await load(); state.runtime = { sessions: {}, tracker: null }; await save(); await schedule(); }));
chrome.runtime.onInstalled.addListener(() => void serial(async () => { await load(); await save(); await schedule(); void broadcast(); }));
