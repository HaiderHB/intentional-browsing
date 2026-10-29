import { normalizeDomain, validateSettings, duration } from './core.js';
import { applyTheme } from './theme.js';
let draft, snapshot;
const $ = selector => document.querySelector(selector);
async function send(type, extra = {}) { const result = await chrome.runtime.sendMessage({ type, ...extra }); if (!result.ok) throw new Error(result.error); return result.data; }
function notice(text, error = false) { $('#status').textContent = text; $('#status').className = error ? 'error' : ''; }
function renderSites() {
  $('#sites').replaceChildren();
  $('#count').textContent = `${draft.sites.length} website${draft.sites.length === 1 ? '' : 's'}`;
  if (!draft.sites.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'Start with the one you open without thinking.'; $('#sites').append(empty); }
  draft.sites.forEach((site, index) => {
    const usage = snapshot.sites.find(s => s.site.domain === site.domain)?.usedMs || 0;
    const row = document.createElement('div'); row.className = 'site-row';
    row.innerHTML = `<div class="site-title"><span class="domain"></span><button type="button" class="danger">Remove</button></div><div class="site-meta"></div><div class="progress"><div></div></div><div class="two"><div class="field"><label for="session-${index}">Slider maximum · minutes</label><input id="session-${index}" type="number" min="1" max="1440" required></div><div class="field"><label for="daily-${index}">Daily limit · minutes</label><input id="daily-${index}" type="number" min="1" max="1440" required></div></div>`;
    row.querySelector('.domain').textContent = site.domain;
    row.querySelector('.danger').setAttribute('aria-label', `Remove ${site.domain}`);
    row.querySelector('.site-meta').textContent = `${duration(usage)} used today · Includes all subdomains`;
    row.querySelector('.progress>div').style.width = `${Math.min(100, usage / (site.dailyLimitMinutes * 60000) * 100)}%`;
    const [session, daily] = row.querySelectorAll('input');
    session.value = site.maxSessionMinutes; daily.value = site.dailyLimitMinutes;
    session.oninput = () => { site.maxSessionMinutes = Number(session.value); notice('Unsaved changes'); };
    daily.oninput = () => { site.dailyLimitMinutes = Number(daily.value); notice('Unsaved changes'); };
    row.querySelector('button').onclick = async event => {
      event.currentTarget.disabled = true;
      try {
        await send('REMOVE_SITE', { domain: site.domain });
        draft.sites = draft.sites.filter(entry => entry.domain !== site.domain);
        snapshot.sites = snapshot.sites.filter(entry => entry.site.domain !== site.domain);
        renderSites(); notice(`${site.domain} removed. Restrictions are off now. Other edits still need saving.`);
      } catch (error) { notice(error.message, true); renderSites(); }
    };
    $('#sites').append(row);
  });
}
function addSite() {
  try {
    const site = { domain: normalizeDomain($('#new-domain').value), maxSessionMinutes: Number($('#new-session').value), dailyLimitMinutes: Number($('#new-daily').value) };
    const candidate = validateSettings({ ...draft, sites: [...draft.sites, site] });
    draft.sites = candidate.sites; renderSites(); $('#new-domain').value = ''; notice('Website added. Save to apply.');
  } catch (error) { notice(error.message, true); }
}
$('#add').onclick = addSite;
$('#new-domain').onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); addSite(); } };
document.querySelectorAll('[data-domain]').forEach(button => { button.onclick = () => { $('#new-domain').value = button.dataset.domain; $('#new-domain').focus(); }; });
$('#unlock-phrase').oninput = () => { draft.phrase = $('#unlock-phrase').value; notice('Unsaved changes'); };
$('#reset-time').oninput = () => { draft.resetTime = $('#reset-time').value; notice('Unsaved changes'); };
$('#add-minutes').oninput = () => { draft.addMinutes = Number($('#add-minutes').value); notice('Unsaved changes'); };
$('#max-adds').oninput = () => { draft.maxAddsPerDay = Number($('#max-adds').value); notice('Unsaved changes'); };
$('#theme').onchange = () => { draft.theme = $('#theme').value; applyTheme(draft.theme); notice('Unsaved changes'); };
$('#warn-before-end').onchange = () => { draft.warnBeforeEnd = $('#warn-before-end').checked; notice('Unsaved changes'); };
$('#widget-corner').onchange = () => { draft.widgetCorner = $('#widget-corner').value; notice('Unsaved changes'); };
$('#settings-form').onsubmit = async event => {
  event.preventDefault();
  try {
    if ($('#new-domain').value.trim()) { addSite(); if ($('#new-domain').value.trim()) return; }
    const settings = validateSettings(draft); $('#save').disabled = true;
    await send('SAVE_SETTINGS', { settings });
    snapshot = await send('DASHBOARD'); draft = structuredClone(snapshot.settings); renderSites();
    notice('Saved. Your next visit starts with a pause.');
  } catch (error) { notice(error.message, true); }
  finally { $('#save').disabled = false; }
};
try { snapshot = await send('DASHBOARD'); draft = structuredClone(snapshot.settings); $('#unlock-phrase').value = draft.phrase; $('#reset-time').value = draft.resetTime; $('#add-minutes').value = draft.addMinutes; $('#max-adds').value = draft.maxAddsPerDay; $('#theme').value = draft.theme; $('#warn-before-end').checked = draft.warnBeforeEnd; $('#widget-corner').value = draft.widgetCorner; renderSites(); }
catch (error) { notice(error.message, true); $('#save').disabled = true; }
