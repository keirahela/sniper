import test from 'node:test';
import assert from 'node:assert/strict';
import { runAccounts } from '../src/accounts.js';
import { runCycle } from '../src/cycle.js';
import { freshState } from '../src/state.js';

const config = { usernames: ['IndieGameJoe', 'IndieGamesLib'], username: 'IndieGameJoe', channelId: '123456789012345678', userId: '123456789012345679' };

test('a failed account does not stop the next account and errors retain their account name', async () => {
  const checked = [];
  const errors = [];
  const batch = await runAccounts(config, async account => {
    checked.push(account.username);
    if (account.username === 'IndieGameJoe') throw new Error('profile unavailable');
    return 'readable';
  }, (username, error) => errors.push([username, error.message]));
  assert.deepEqual(checked, ['IndieGameJoe', 'IndieGamesLib']);
  assert.deepEqual(errors, [['IndieGameJoe', 'profile unavailable']]);
  assert.equal(batch.results[0].username, 'IndieGamesLib');
  assert.equal(config.username, 'IndieGameJoe');
});

test('each account gets its own baseline, checkpoint, and correctly attributed notifications', async () => {
  const states = new Map();
  const sent = [];
  async function cycle() {
    return runAccounts(config, account => runCycle({
      store: {
        load: async () => structuredClone(states.get(account.username) || freshState(account)),
        save: async state => states.set(account.username, structuredClone(state)),
      },
      scan: async () => [{ id: account.username === 'IndieGameJoe' ? '1000' : '100', hasVideo: true, url: `https://x.com/${account.username}/status/${account.username === 'IndieGameJoe' ? '1000' : '100'}` }],
      send: async post => sent.push([account.username, post.id]),
    }));
  }
  states.set('IndieGameJoe', { ...freshState(config), lastSeenId: '999' });
  await cycle();
  assert.deepEqual(sent, [['IndieGameJoe', '1000']]);
  assert.equal(states.get('IndieGamesLib').lastSeenId, '100');
  await cycle();
  assert.deepEqual(sent, [['IndieGameJoe', '1000']]);
});
