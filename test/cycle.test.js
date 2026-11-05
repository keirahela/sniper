import test from 'node:test';
import assert from 'node:assert/strict';
import { runCycle } from '../src/cycle.js';

function memoryStore(initial) {
  return {
    state: structuredClone(initial),
    writes: [],
    async load() { return structuredClone(this.state); },
    async save(next) { this.state = structuredClone(next); this.writes.push(structuredClone(next)); },
  };
}
const post = (id, hasVideo = true) => ({ id, hasVideo, url: `https://x.com/IndieGameJoe/status/${id}` });

test('one-shot first run creates a baseline without historical notifications', async () => {
  const store = memoryStore({ lastSeenId: null, pending: [] });
  const result = await runCycle({ store, scan: async id => { assert.equal(id, null); return [post('100')]; }, send: async () => assert.fail('historical ping') });
  assert.equal(result.baseline, true);
  assert.equal(store.state.lastSeenId, '100');
  assert.deepEqual(store.state.pending, []);
});

test('remote queue is saved before delivery, and a later run recovers failed sends', async () => {
  const store = memoryStore({ lastSeenId: '100', pending: [] });
  await assert.rejects(runCycle({ store, scan: async () => [post('101'), post('102', false)], send: async () => {
    assert.equal(store.state.lastSeenId, '102');
    assert.deepEqual(store.state.pending.map(p => p.id), ['101']);
    throw new Error('Discord unavailable');
  } }), /Discord unavailable/);
  const sent = [];
  await assert.rejects(runCycle({ store, scan: async () => { throw new Error('X unavailable'); }, send: async value => sent.push(value.id) }), /X unavailable/);
  assert.deepEqual(sent, ['101']);
  assert.deepEqual(store.state.pending, []);
  const result = await runCycle({ store, scan: async () => [post('102', false)], send: async () => assert.fail('duplicate ping') });
  assert.equal(result.alertsSent, 0);
});

test('does not send an alert if persisting the checkpoint failed', async () => {
  const store = memoryStore({ lastSeenId: '100', pending: [] });
  store.save = async () => { throw new Error('GitHub permission denied'); };
  await assert.rejects(runCycle({ store, scan: async () => [post('101')], send: async () => assert.fail('unpersisted alert') }), /GitHub permission denied/);
});

test('an unchanged timeline does not create empty GitHub commits', async () => {
  const store = memoryStore({ lastSeenId: '100', pending: [] });
  await runCycle({ store, scan: async () => [post('100')], send: async () => assert.fail('duplicate ping') });
  assert.equal(store.writes.length, 0);
});

test('X rate-limit cooldown survives separate scheduled runs', async () => {
  const store = memoryStore({ lastSeenId: '100', pending: [] });
  const rateLimit = Object.assign(new Error('X rate limited'), { retryAfterMs: 900000 });
  await assert.rejects(runCycle({ store, now: () => 1000, scan: async () => { throw rateLimit; }, send: async () => {} }), /X rate limited/);
  const skipped = await runCycle({ store, now: () => 300000, scan: async () => assert.fail('ignored cooldown'), send: async () => {} });
  assert.equal(skipped.skipped, true);
  assert.equal(skipped.retryAfterAt, 901000);
  await runCycle({ store, now: () => 902000, scan: async () => [post('100')], send: async () => {} });
  assert.equal(store.state.retryAfterAt, undefined);
});
