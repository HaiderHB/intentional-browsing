import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { isOwnRequest, isExtensionUi, createSerialQueue, createRequestListener } from '../extension/messaging.js';
const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
const sender = { id: extensionId, url: `chrome-extension://${extensionId}/options.html` };

test('unrelated and malformed messages are ignored before state or response channels are touched', async () => {
  const handle = mock.fn(), enqueue = mock.fn(), respond = mock.fn();
  const listener = createRequestListener({ extensionId, enqueue, handle });
  for (const message of [null, undefined, {}, 'STATUS', { type: 'REFRESH' }, { type: 'SOMETHING_ELSE' }]) {
    assert.equal(listener(message, sender, respond), false);
  }
  assert.equal(listener({ type: 'STATUS' }, { ...sender, id: 'other-extension' }, respond), false);
  assert.equal(enqueue.mock.callCount(), 0); assert.equal(handle.mock.callCount(), 0); assert.equal(respond.mock.callCount(), 0);
  assert.equal(isOwnRequest({ type: 'ADD_TIME' }, sender, extensionId), true);
});

test('settings and popup URLs allow fragments/queries without accepting other origins or pages', () => {
  for (const path of ['options.html', 'options.html#settings', 'options.html?tab=sites#daily', 'popup.html']) {
    assert.equal(isExtensionUi({ ...sender, url: `chrome-extension://${extensionId}/${path}` }, extensionId), true);
  }
  for (const url of [`https://${extensionId}/options.html`, 'chrome-extension://other/options.html',
    `chrome-extension://${extensionId}/options.html.evil`, `chrome-extension://${extensionId}/background.js`, undefined]) {
    assert.equal(isExtensionUi({ ...sender, url }, extensionId), false);
  }
  assert.equal(isExtensionUi({ ...sender, id: 'other' }, extensionId), false);
});

test('rejected requests respond once without console errors and do not break subsequent requests', async () => {
  const errors = mock.method(console, 'error', () => {});
  try {
    const enqueue = createSerialQueue(), order = [];
    const listener = createRequestListener({ extensionId, enqueue, handle: async message => {
      order.push(message.type);
      if (message.type === 'ADD_TIME') throw new Error('No extra-time uses left today.');
      return { mode: 'gate' };
    } });
    const call = type => new Promise(resolve => assert.equal(listener({ type }, sender, resolve), true));
    const [rejected, next] = await Promise.all([call('ADD_TIME'), call('STATUS')]);
    assert.deepEqual(rejected, { ok: false, error: 'No extra-time uses left today.' });
    assert.deepEqual(next, { ok: true, data: { mode: 'gate' } });
    assert.deepEqual(order, ['ADD_TIME', 'STATUS']);
    assert.equal(errors.mock.callCount(), 0);
  } finally { errors.mock.restore(); }
});
