const requestTypes = new Set(['DASHBOARD', 'SAVE_SETTINGS', 'REMOVE_SITE', 'OPEN_SETTINGS', 'CLOSE_TAB', 'STATUS', 'UNLOCK', 'ADD_TIME', 'END_SESSION', 'SET_WIDGET_CORNER']);

export function isOwnRequest(message, sender, extensionId) {
  return sender?.id === extensionId && message !== null && typeof message === 'object' && requestTypes.has(message.type);
}

export function isExtensionUi(sender, extensionId) {
  if (sender?.id !== extensionId) return false;
  try {
    const url = new URL(sender.url);
    return url.protocol === 'chrome-extension:' && url.hostname === extensionId &&
      ['/options.html', '/popup.html'].includes(url.pathname);
  } catch { return false; }
}

// Keep the queue usable after a handled rejection. The caller owns reporting:
// request errors go to their caller; unexpected event errors go to the console.
export function createSerialQueue() {
  let queue = Promise.resolve();
  return job => {
    const result = queue.then(job);
    queue = result.catch(() => {});
    return result;
  };
}

export function createRequestListener({ extensionId, enqueue, handle }) {
  return (message, sender, respond) => {
    // Chrome can deliver messages not belonging to this request protocol.
    // They must not touch state, claim a response channel, or become errors.
    if (!isOwnRequest(message, sender, extensionId)) return false;
    enqueue(() => handle(message, sender)).then(
      data => respond({ ok: true, data }),
      error => respond({ ok: false, error: error.message || 'Unable to complete this request.' })
    );
    return true;
  };
}
