import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig, parseAccounts } from '../src/config.js';
import { alertPayload, recipientMentions } from '../src/discord.js';
import { encodeCheckpoint, decodeCheckpoint } from '../src/github-state.js';
import { freshState } from '../src/state.js';

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

test('watch list defaults to both accounts and supports normalized, deduplicated overrides', () => {
  assert.deepEqual(readConfig({}, { discord: false }).usernames, ['IndieGameJoe', 'IndieGamesLib']);
  assert.deepEqual(parseAccounts([' @IndieGameJoe ', 'https://x.com/IndieGamesLib/', 'indiegamejoe']), ['IndieGameJoe', 'IndieGamesLib']);
  assert.deepEqual(readConfig({ X_USERNAMES: '@IndieGamesLib,IndieGameJoe', X_USERNAME: 'OldAccount' }, { discord: false }).usernames, ['IndieGamesLib', 'IndieGameJoe']);
  for (const input of [[], [''], [null], ['../bad'], 'IndieGameJoe']) assert.throws(() => parseAccounts(input));
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
  assert.match(alertPayload({ userId: '123456789012345678', username: 'IndieGamesLib' }, { id: '101', url: 'https://x.com/IndieGamesLib/status/101' }).content, /from @IndieGamesLib/);
});

test('additional recipients keep the original user and allow only distinct user pings', () => {
  const config = readConfig({ DISCORD_USER_ID: '123456789012345678', DISCORD_ADDITIONAL_USER_IDS: ' 123456789012345679,123456789012345678,123456789012345679 ' }, { discord: false });
  assert.equal(config.userId, '123456789012345678');
  assert.deepEqual(config.userIds, ['123456789012345678', '123456789012345679']);
  const payload = alertPayload(config, { id: '101', url: 'https://x.com/IndieGameJoe/status/101' });
  assert.equal(payload.content, '<@123456789012345678> <@123456789012345679> New video post from @IndieGameJoe\nhttps://x.com/IndieGameJoe/status/101');
  assert.deepEqual(payload.allowedMentions, { parse: [], users: config.userIds });
  assert.deepEqual(recipientMentions(config).allowedMentions, payload.allowedMentions);
  for (const extra of ['@everyone', '123', '<@123456789012345679>']) {
    assert.throws(() => readConfig({ DISCORD_ADDITIONAL_USER_IDS: extra }, { discord: false }), /valid user IDs/);
  }
});

test('adding a notification recipient preserves existing checkpoints and pending alerts', () => {
  const original = { username: 'IndieGameJoe', channelId: '123456789012345677', userId: '123456789012345678' };
  const state = { ...freshState(original), lastSeenId: '102', pending: [{ id: '101', url: 'https://x.com/IndieGameJoe/status/101' }] };
  const updated = { ...original, userIds: [original.userId, '123456789012345679'] };
  assert.deepEqual(decodeCheckpoint(encodeCheckpoint(state, original), updated), state);
  const publicState = JSON.stringify(encodeCheckpoint(state, updated));
  assert.equal(publicState.includes('123456789012345679'), false);
});
