export const MINUTE = 60_000;
export const MAX_GAP = 5_000;
export const WIDGET_CORNERS = ['top-right', 'top-left', 'bottom-right', 'bottom-left'];
export const defaults = () => ({ phrase: 'unlock now', resetTime: '03:00', addMinutes: 5, maxAddsPerDay: 3, theme: 'system', warnBeforeEnd: false, widgetCorner: 'top-right', sites: [] });

export function normalizeDomain(value) {
  const text = String(value ?? '').trim();
  if (!text || /[\s*]/.test(text)) throw new Error('Enter a website such as youtube.com.');
  let url;
  try { url = new URL(text.includes('://') ? text : `https://${text}`); }
  catch { throw new Error('Enter a valid website address.'); }
  const domain = url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !domain ||
      (domain !== 'localhost' && !domain.includes('.')) || /[^a-z0-9.\-]/.test(domain) ||
      domain.split('.').some(part => !part || part.startsWith('-') || part.endsWith('-'))) {
    throw new Error('Use an HTTP or HTTPS website domain.');
  }
  return domain;
}

export function findSite(settings, url) {
  let host;
  try { const parsed = new URL(url); if (!['http:', 'https:'].includes(parsed.protocol)) return null; host = parsed.hostname.toLowerCase().replace(/\.$/, ''); }
  catch { return null; }
  return settings.sites.find(site => host === site.domain || host.endsWith(`.${site.domain}`)) ?? null;
}

export function validateSettings(input) {
  if (!input || typeof input.phrase !== 'string' || !input.phrase.trim() || input.phrase.length > 160)
    throw new Error('Your unlock phrase must contain 1–160 characters.');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.resetTime)) throw new Error('Choose a valid daily reset time.');
  const addMinutes = input.addMinutes ?? 5, maxAddsPerDay = input.maxAddsPerDay ?? 3;
  const theme = input.theme ?? 'system', warnBeforeEnd = input.warnBeforeEnd ?? false, widgetCorner = input.widgetCorner ?? 'top-right';
  if (!['system', 'light', 'dark'].includes(theme)) throw new Error('Choose a valid appearance.');
  if (typeof warnBeforeEnd !== 'boolean') throw new Error('Choose whether to show the ten-second warning.');
  if (!WIDGET_CORNERS.includes(widgetCorner)) throw new Error('Choose a valid widget corner.');
  if (!Number.isInteger(addMinutes) || addMinutes < 1 || addMinutes > 1440)
    throw new Error('Extra time must be a whole number of minutes between 1 and 1,440.');
  if (!Number.isInteger(maxAddsPerDay) || maxAddsPerDay < 0 || maxAddsPerDay > 100)
    throw new Error('Extra-time uses must be a whole number between 0 and 100 per day.');
  if (!Array.isArray(input.sites) || input.sites.length > 100) throw new Error('You can add up to 100 websites.');
  const sites = input.sites.map(site => {
    const domain = normalizeDomain(site.domain);
    for (const field of ['maxSessionMinutes', 'dailyLimitMinutes']) {
      if (!Number.isInteger(site[field]) || site[field] < 1 || site[field] > 1440)
        throw new Error('Time limits must be whole minutes between 1 and 1,440.');
    }
    return { domain, maxSessionMinutes: site.maxSessionMinutes, dailyLimitMinutes: site.dailyLimitMinutes };
  });
  for (let i = 0; i < sites.length; i++) for (let j = i + 1; j < sites.length; j++) {
    const a = sites[i].domain, b = sites[j].domain;
    if (a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`))
      throw new Error(`${a} and ${b} overlap. One entry already covers its subdomains.`);
  }
  return { phrase: input.phrase.trim(), resetTime: input.resetTime, addMinutes, maxAddsPerDay, theme, warnBeforeEnd, widgetCorner, sites };
}

// Calendar arithmetic, rather than adding 24h, preserves the local reset across DST.
export function dayWindow(now, resetTime) {
  const [hours, minutes] = resetTime.split(':').map(Number);
  const start = new Date(now);
  start.setHours(hours, minutes, 0, 0);
  if (start.getTime() > now) { start.setDate(start.getDate() - 1); start.setHours(hours, minutes, 0, 0); }
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  end.setHours(hours, minutes, 0, 0);
  return { start: start.getTime(), end: end.getTime() };
}

export function freshLedger(now, settings) { return { start: dayWindow(now, settings.resetTime).start, totals: {}, addsUsed: {} }; }

export function advance(state, now) {
  state.ledger.addsUsed ??= {};
  const { settings, runtime } = state;
  const window = dayWindow(now, settings.resetTime);
  const tracker = runtime.tracker;
  if (tracker) {
    const session = runtime.sessions[tracker.domain];
    const site = settings.sites.find(s => s.domain === tracker.domain);
    // A missing heartbeat means a suspended page/computer, not hours of use.
    if (site && session && now >= tracker.at && now - tracker.at <= MAX_GAP) {
      const oldEnd = dayWindow(tracker.at, settings.resetTime).end;
      const elapsed = Math.max(0, Math.min(now, session.expiresAt, oldEnd) - tracker.at);
      if (state.ledger.start === dayWindow(tracker.at, settings.resetTime).start) {
        const previous = state.ledger.totals[site.domain] || 0;
        state.ledger.totals[site.domain] = Math.max(previous, Math.min(site.dailyLimitMinutes * MINUTE, previous + elapsed));
      }
    }
    tracker.at = now;
  }
  if (state.ledger.start !== window.start) {
    state.ledger = { start: window.start, totals: {}, addsUsed: {} };
    runtime.sessions = {};
    runtime.tracker = null;
  }
  for (const [domain, session] of Object.entries(runtime.sessions)) {
    const site = settings.sites.find(s => s.domain === domain);
    if (!site || session.expiresAt <= now || (state.ledger.totals[domain] || 0) >= site.dailyLimitMinutes * MINUTE) {
      delete runtime.sessions[domain];
      if (runtime.tracker?.domain === domain) runtime.tracker = null;
    }
  }
}

export function siteStatus(state, site, now) {
  if (!site) return { mode: 'unmanaged' };
  const usedMs = state.ledger.totals[site.domain] || 0;
  const remainingMs = Math.max(0, site.dailyLimitMinutes * MINUTE - usedMs);
  const expiresAt = state.runtime.sessions[site.domain]?.expiresAt || 0;
  const resetAt = dayWindow(now, state.settings.resetTime).end;
  const addsRemaining = Math.max(0, (state.settings.maxAddsPerDay ?? 3) - (state.ledger.addsUsed?.[site.domain] || 0));
  const addableMs = Math.max(0, Math.min(resetAt, now + remainingMs) - expiresAt);
  return { site, usedMs, remainingMs, expiresAt, now,
    resetAt, addsRemaining, addMinutes: state.settings.addMinutes ?? 5,
    canAddTime: expiresAt > now && remainingMs > 0 && addsRemaining > 0 && addableMs > 0,
    phrase: state.settings.phrase, theme: state.settings.theme ?? 'system',
    warnBeforeEnd: state.settings.warnBeforeEnd ?? false, widgetCorner: state.settings.widgetCorner ?? 'top-right',
    maxMinutes: Math.min(site.maxSessionMinutes, Math.ceil(remainingMs / MINUTE)),
    mode: remainingMs === 0 ? 'blocked' : expiresAt > now ? 'open' : 'gate' };
}

export function addTime(state, site, now) {
  advance(state, now);
  const status = siteStatus(state, site, now);
  if (status.mode !== 'open') throw new Error('Unlock a session before adding time.');
  if (status.addsRemaining === 0) throw new Error('You have used all extra-time clicks for this website today.');
  if (!status.canAddTime) throw new Error('This session already includes your remaining daily allowance.');
  state.runtime.sessions[site.domain].expiresAt = Math.min(
    status.expiresAt + status.addMinutes * MINUTE, now + status.remainingMs, status.resetAt
  );
  state.ledger.addsUsed[site.domain] = (state.ledger.addsUsed[site.domain] || 0) + 1;
  return siteStatus(state, site, now);
}

export function unlock(state, site, minutes, phrase, now) {
  advance(state, now);
  const status = siteStatus(state, site, now);
  if (!site || status.mode === 'blocked') throw new Error('This website has reached its daily limit.');
  if (phrase !== state.settings.phrase) throw new Error('Type the unlock phrase exactly as shown.');
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > status.maxMinutes) throw new Error('Choose a time within your session limit.');
  if (status.mode === 'open') return status; // Concurrent tabs cannot extend an existing grant.
  state.runtime.sessions[site.domain] = {
    expiresAt: Math.min(now + minutes * MINUTE, status.resetAt, now + status.remainingMs)
  };
  return siteStatus(state, site, now);
}

export function duration(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
