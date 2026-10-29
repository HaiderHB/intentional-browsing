import { duration } from './core.js';
import './theme.js';
document.querySelector('#settings').onclick = () => chrome.runtime.openOptionsPage();
try {
  const response = await chrome.runtime.sendMessage({ type: 'DASHBOARD' });
  if (!response.ok) throw new Error(response.error);
  const { sites, resetAt } = response.data;
  document.querySelector('#reset').textContent = `Today, until ${new Date(resetAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. A fresh start follows.`;
  const container = document.querySelector('#usage');
  if (!sites.length) container.innerHTML = '<div class="empty">Add your first website to make room for what matters.</div>';
  for (const status of sites) {
    const row = document.createElement('div'); row.className = 'site-row';
    row.innerHTML = '<div class="site-title"><span class="domain"></span><span class="time"></span></div><div class="progress"><div></div></div><div class="site-meta"></div>';
    row.querySelector('.domain').textContent = status.site.domain;
    row.querySelector('.time').textContent = `${duration(status.usedMs)} / ${status.site.dailyLimitMinutes}m`;
    row.querySelector('.progress>div').style.width = `${Math.min(100, status.usedMs / (status.site.dailyLimitMinutes * 60000) * 100)}%`;
    row.querySelector('.site-meta').textContent = status.mode === 'blocked' ? 'Blocked until your next day' : status.mode === 'open' ? `${duration(status.expiresAt - status.now)} left this session` : 'A pause before your next visit';
    container.append(row);
  }
} catch { document.querySelector('#reset').textContent = 'Could not load usage. Close and reopen this popup.'; }
