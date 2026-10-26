(() => {
  if (globalThis.__intentionalLoaded) return;
  globalThis.__intentionalLoaded = true;
  let host, root, dialog, widget, current, signature = '', busy = false, timer;
  const time = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const clock = ms => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const css = `
    :host{all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;font-family:Arial,sans-serif!important;color:#242d28!important;color-scheme:light!important}
    *{box-sizing:border-box}button,input{font:inherit}button{cursor:pointer}button:focus-visible,input:focus-visible{outline:3px solid #98ae87;outline-offset:4px}
    dialog{position:fixed;inset:0;margin:0;padding:0;width:100vw;height:100dvh;max-width:none;max-height:none;border:0;background:#f6f4ed;color:#242d28;pointer-events:auto;font:15px/1.5 Arial,sans-serif;overflow:auto}
    dialog::backdrop{background:#f6f4ed}.shell{min-height:100dvh;display:flex;flex-direction:column;padding:32px 42px}
    .brand{display:flex;align-items:center;gap:10px;font-size:17px;font-weight:700;letter-spacing:-.5px}.mark{display:inline-flex;align-items:center;justify-content:center;border-radius:50%;width:30px;height:30px;background:#dce5d1;color:#40543a;font-size:14px;letter-spacing:2px;padding-left:2px}
    .panel{width:min(100%,470px);margin:auto;padding:40px 0}.eyebrow{font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#697a61}.site{display:inline-block;background:#eae9df;border:1px solid #deded1;border-radius:100px;padding:6px 13px;font-size:12px;margin:20px 0 12px}
    h1{font:normal clamp(37px,5vw,52px)/1.08 Georgia,serif;letter-spacing:-1.6px;margin:4px 0 16px}p{color:#687068;margin:0 0 25px}.field{margin-top:27px}label{display:block;font-size:13px;font-weight:600;margin-bottom:12px}.range-head{display:flex;justify-content:space-between;align-items:center;gap:12px}.range-head label{margin:0}.value{font:27px Georgia,serif;white-space:nowrap}.value small{font:12px Arial,sans-serif;color:#697168}
    input[type=range]{display:block;width:100%;height:26px;margin:14px 0 3px;accent-color:#60734e;cursor:pointer}.range-ends{display:flex;justify-content:space-between;color:#798175;font-size:11px}.phrase{color:#465b3c;background:#e8eddf;border-radius:5px;padding:3px 7px;overflow-wrap:anywhere;font-weight:400;user-select:none}
    input[type=text]{width:100%;border:1px solid #d7dbcf;border-radius:10px;background:#fffefa;padding:15px;color:#283326;font-size:15px}input[type=text]:focus{border-color:#7b8c68;outline:3px solid #e2e8d8}
    .primary{width:100%;border:0;border-radius:10px;background:#344632;color:#fff;padding:15px 18px;font-weight:600;margin-top:20px;transition:background .15s}.primary:hover{background:#233321}.primary:disabled{background:#dce0d5;color:#7a8474;cursor:default}.leave{display:block;margin:16px auto 0;border:0;background:none;color:#6d756a;font-size:12px;padding:8px}.leave:hover{text-decoration:underline}.foot{display:flex;justify-content:space-between;gap:12px;color:#80867c;font-size:11px;max-width:100%;}.text-button{background:none;border:0;color:#687261;padding:0;font-size:11px;text-decoration:underline}.error{font-size:12px;color:#a34234;margin:10px 0 0;min-height:18px}.summary{padding:18px;border:1px solid #daddcf;border-radius:12px;margin:26px 0;color:#596750;font-size:14px}.summary strong{color:#344632}.small{font-size:12px;color:#7a8373;margin:16px 0 0}
    .widget{position:fixed;right:18px;top:18px;width:230px;padding:14px 16px;border:1px solid #d8decc;border-radius:14px;background:rgba(248,248,240,.76);backdrop-filter:blur(12px);box-shadow:0 4px 24px #29372114;color:#293627;pointer-events:auto;font:12px/1.4 Arial,sans-serif;transition:background .2s}.widget:hover,.widget:focus-within{background:rgba(248,248,240,.98)}.widget-head{display:flex;justify-content:space-between;gap:8px;color:#6d7865;font-size:10px;text-transform:uppercase;letter-spacing:1px}.widget-time{font-size:27px;letter-spacing:-1px;font-variant-numeric:tabular-nums;margin:7px 0 0}.widget-time span{font-size:11px;letter-spacing:0;color:#6d7865}.widget-bottom{display:flex;justify-content:space-between;align-items:center;margin-top:8px;color:#717b68;font-size:10px}.widget button{border:0;background:none;padding:3px 0 3px 8px;font-size:10px;color:#455b38;text-decoration:underline}.track{height:3px;border-radius:4px;background:#dfe5d8;margin-top:10px;overflow:hidden}.fill{height:100%;background:#82966b;max-width:100%}
    [hidden]{display:none!important}@media(max-width:600px){.shell{padding:22px}.panel{padding:40px 0}.foot{flex-wrap:wrap}.widget{right:10px;top:10px;width:208px}}
  `;
  async function request(type, extra = {}) {
    const response = await chrome.runtime.sendMessage({ type, visible: !document.hidden, ...extra });
    if (!response?.ok) throw new Error(response?.error || 'Could not connect to Intentional.');
    return response.data;
  }
  function mount() {
    if (host?.isConnected) return;
    host = document.createElement('intentional-focus');
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${css}</style><dialog aria-label="Intentional website pause"></dialog><aside class="widget" aria-label="Website usage today" hidden></aside>`;
    (document.documentElement || document).append(host);
    dialog = root.querySelector('dialog'); widget = root.querySelector('aside');
    dialog.addEventListener('cancel', e => e.preventDefault());
    signature = '';
  }
  function pauseMedia() {
    document.querySelectorAll('video,audio').forEach(media => media.pause());
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
  }
  document.addEventListener('play', event => {
    if (current && current.mode !== 'open' && current.mode !== 'unmanaged' && typeof event.target.pause === 'function') event.target.pause();
  }, true);
  function show(data) {
    current = data;
    if (data.mode === 'unmanaged') {
      host?.remove(); signature = ''; clearInterval(timer); timer = null; return;
    }
    mount();
    const nextSignature = [data.mode, data.site?.domain, data.phrase, data.maxMinutes].join('|');
    if (data.mode === 'open') {
      if (dialog.open) dialog.close(); widget.hidden = false;
      if (signature !== nextSignature) {
        widget.innerHTML = `<div class="widget-head"><span>Intentional</span><span>Today</span></div><div class="widget-time"><b id="used"></b> <span id="limit"></span></div><div class="track"><div class="fill"></div></div><div class="widget-bottom"><span id="session"></span><button id="end">End session</button></div>`;
        widget.querySelector('#end').onclick = async () => { try { show(await request('END_SESSION')); } catch { void refresh(); } };
      }
      widget.querySelector('#used').textContent = time(data.usedMs);
      widget.querySelector('#limit').textContent = `/ ${data.site.dailyLimitMinutes} min`;
      widget.querySelector('#session').textContent = `${time(data.expiresAt - data.now)} left this session`;
      widget.querySelector('.fill').style.width = `${data.usedMs / (data.site.dailyLimitMinutes * 60000) * 100}%`;
    } else {
      widget.hidden = true;
      pauseMedia();
      if (signature !== nextSignature) {
        const blocked = data.mode === 'blocked';
        dialog.innerHTML = `<div class="shell"><div class="brand"><span class="mark" aria-hidden="true">Ⅱ</span>intentional</div><main class="panel"><div class="eyebrow">${blocked ? 'Enough for today' : 'A little space to choose'}</div><div class="site"></div><h1>${blocked ? 'You kept your limit.<br>Keep your day.' : 'A moment,<br>before you go.'}</h1><p>${blocked ? 'This website is blocked for the rest of your day.<br>There’s a whole world beyond this tab.' : 'Make a little room for intention.<br>How long would you like to stay?'}</p>${blocked ? '<div class="summary"></div><button class="primary" id="close">Close this tab</button>' : '<form><div class="field"><div class="range-head"><label for="minutes">How many minutes?</label><output class="value" for="minutes"><span id="chosen">5</span> <small>min</small></output></div><input id="minutes" type="range" min="1" step="1"><div class="range-ends"><span>1 minute</span><span id="max"></span></div></div><div class="field"><label for="phrase">To continue, type <span class="phrase"></span></label><input id="phrase" type="text" placeholder="Your intention starts here" autocomplete="off" spellcheck="false" autocapitalize="off" aria-describedby="error"></div><div id="error" class="error" role="status"></div><button type="submit" class="primary" disabled>Begin my session <span aria-hidden="true">↗</span></button></form><button id="close" class="leave">Actually, I’ll do something else</button>'}<div class="small" id="usage"></div></main><footer class="foot"><span>Your time. On purpose.</span><button class="text-button" id="settings">Settings</button></footer></div>`;
        dialog.querySelector('.site').textContent = data.site.domain;
        dialog.querySelector('#settings').onclick = () => request('OPEN_SETTINGS');
        dialog.querySelector('#close').onclick = () => request('CLOSE_TAB');
        if (blocked) dialog.querySelector('.summary').textContent = `${data.site.dailyLimitMinutes} minute${data.site.dailyLimitMinutes === 1 ? '' : 's'} used today. Available again at ${clock(data.resetAt)}.`;
        else {
          const range = dialog.querySelector('#minutes'), input = dialog.querySelector('#phrase'), button = dialog.querySelector('[type=submit]');
          range.max = data.maxMinutes; range.value = Math.min(5, data.maxMinutes);
          dialog.querySelector('#chosen').textContent = range.value;
          dialog.querySelector('#max').textContent = `${data.maxMinutes} min max`;
          dialog.querySelector('.phrase').textContent = data.phrase;
          range.oninput = () => { dialog.querySelector('#chosen').textContent = range.value; };
          input.oninput = () => { button.disabled = input.value !== data.phrase; };
          for (const event of ['paste', 'drop']) input.addEventListener(event, e => { e.preventDefault(); dialog.querySelector('#error').textContent = 'Take a moment to type it by hand.'; });
          input.addEventListener('beforeinput', e => { if (['insertFromPaste', 'insertFromDrop'].includes(e.inputType)) e.preventDefault(); });
          dialog.querySelector('form').onsubmit = async event => {
            event.preventDefault(); button.disabled = true;
            try { show(await request('UNLOCK', { minutes: Number(range.value), phrase: input.value })); }
            catch (error) { dialog.querySelector('#error').textContent = error.message; button.disabled = input.value !== data.phrase; }
          };
        }
      }
      dialog.querySelector('#usage').textContent = `${time(data.usedMs)} used today · Resets at ${clock(data.resetAt)}`;
      if (!dialog.open) dialog.showModal();
    }
    signature = nextSignature;
  }
  async function refresh() {
    if (busy) return;
    busy = true;
    try {
      show(await request('STATUS'));
      if (current.mode !== 'unmanaged' && !timer) timer = setInterval(refresh, 1000);
    } catch (error) {
      if (current && current.mode !== 'unmanaged') {
        mount(); widget.hidden = true; pauseMedia();
        dialog.innerHTML = '<div class="shell"><main class="panel"><div class="eyebrow">A quick reset</div><h1>Let’s reconnect.</h1><p>Reload this page to reconnect to Intentional.</p><button class="primary">Reload page</button></main></div>';
        dialog.querySelector('button').onclick = () => location.reload();
        if (!dialog.open) dialog.showModal(); signature = '';
      }
    } finally { busy = false; }
  }
  chrome.runtime.onMessage.addListener(message => { if (message.type === 'REFRESH') void refresh(); });
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('pageshow', refresh);
  window.addEventListener('focus', refresh);
  void refresh();
})();
