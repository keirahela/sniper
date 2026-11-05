import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../src/config.js';
import { alertPayload } from '../src/discord.js';

test('configuration accepts the supplied profile URL without requiring Discord for setup', () => {
  const config = readConfig({ X_USERNAME: 'https://x.com/IndieGameJoe' }, { discord: false });
  assert.equal(config.username, 'IndieGameJoe');
  assert.equal(config.pollIntervalMs, 120000);
  assert.equal(config.headless, true);
});

test('configuration rejects missing secrets, unsafe usernames, rapid polls, and invalid booleans', () => {
  assert.throws(() => readConfig({}), /DISCORD_TOKEN/);
  for (const env of [{ X_USERNAME: '../bad' }, { POLL_INTERVAL_SECONDS: '2' }, { HEADLESS: 'perhaps' }]) {
    assert.throws(() => readConfig(env, { discord: false }));
  }
});

test('notification permits only the intended user mention and provides a deduplication nonce', () => {
  const payload = alertPayload({ userId: '123456789012345678', username: 'IndieGameJoe' }, {
    id: '2000000000000000001', url: 'https://x.com/IndieGameJoe/status/2000000000000000001',
  });
  assert.deepEqual(payload.allowedMentions, { parse: [], users: ['123456789012345678'] });
  assert.match(payload.content, /<@123456789012345678>/);
  assert.match(payload.content, /https:\/\/x.com\/IndieGameJoe\/status\/2000000000000000001/);
  assert.equal(payload.nonce, '2000000000000000001');
  assert.equal(payload.enforceNonce, true);
});
