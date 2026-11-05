import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { accountStateStore, drainPending, freshState, loadState, saveState, validateState } from '../src/state.js';

const config = { username: 'IndieGameJoe', channelId: '123456789012345678', userId: '123456789012345679' };
const post = id => ({ id, url: `https://x.com/IndieGameJoe/status/${id}` });

test('changing username capitalization preserves pending alerts for the same account', () => {
  const state = { ...freshState(config), lastSeenId: '102', pending: [post('101')] };
  assert.equal(validateState(state, { ...config, username: 'indiegamejoe' }), state);
  assert.throws(() => validateState({ ...state, pending: [null] }, config), /Saved state is invalid/);
});

test('failed delivery keeps unsent alerts, while earlier successful sends stay committed', async () => {
  let persisted = { ...freshState(config), lastSeenId: '102', pending: [post('101'), post('102')] };
  const sent = [];
  await assert.rejects(drainPending(persisted, async value => {
    if (value.id === '102') throw new Error('Discord unavailable');
    sent.push(value.id);
  }, async next => { persisted = next; }), /Discord unavailable/);
  assert.deepEqual(sent, ['101']);
  assert.deepEqual(persisted.pending.map(value => value.id), ['102']);
  const final = await drainPending(persisted, async value => sent.push(value.id), async next => { persisted = next; });
  assert.deepEqual(sent, ['101', '102']);
  assert.equal(final.lastSeenId, '102');
  assert.deepEqual(final.pending, []);
});

test('does not send the next queued alert when saving acknowledgement fails', async () => {
  const sent = [];
  await assert.rejects(drainPending({ pending: [post('101'), post('102')] }, async value => sent.push(value.id), async () => {
    throw new Error('disk full');
  }), /disk full/);
  assert.deepEqual(sent, ['101']);
});

test('state survives restart and refuses corrupt or differently scoped state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'video-alerts-'));
  const path = join(directory, 'state.json');
  try {
    const state = await loadState(path, config);
    assert.equal(state.lastSeenId, null);
    const queued = { ...state, lastSeenId: '102', pending: [post('101')] };
    await saveState(path, queued);
    assert.deepEqual(await loadState(path, config), queued);
    await assert.rejects(loadState(path, { ...config, userId: '111111111111111111' }), /different account or Discord destination/);
    await writeFile(path, '{corrupt');
    await assert.rejects(loadState(path, config), /Cannot read saved state/);
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});

test('local per-account storage migrates only the matching legacy account and preserves its queue', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'video-account-state-'));
  try {
    const legacy = { ...freshState(config), lastSeenId: '102', pending: [post('101')] };
    await saveState(join(directory, 'state.json'), legacy);
    const joe = accountStateStore(directory, config);
    assert.deepEqual(await joe.load(), legacy);
    assert.equal(joe.needsMigration, true);
    const libraryConfig = { ...config, username: 'IndieGamesLib' };
    const library = accountStateStore(directory, libraryConfig);
    assert.equal((await library.load()).lastSeenId, null);
    await library.save({ ...freshState(libraryConfig), lastSeenId: '50' });
    await joe.save(legacy);
    assert.deepEqual(await accountStateStore(directory, config).load(), legacy);
    assert.equal((await accountStateStore(directory, libraryConfig).load()).lastSeenId, '50');
    assert.deepEqual(await loadState(join(directory, 'state.json'), config), legacy);
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});
