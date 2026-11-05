import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubStateStore, encodeCheckpoint, decodeCheckpoint } from '../src/github-state.js';
import { freshState } from '../src/state.js';

const config = { username: 'IndieGameJoe', channelId: '123456789012345678', userId: '123456789012345679' };
const env = { GITHUB_REPOSITORY: 'example/video-alerts', GITHUB_TOKEN: 'fixture-token', GITHUB_SHA: 'a'.repeat(40) };
const nextState = () => ({ ...freshState(config), lastSeenId: '102', pending: [{ id: '101', url: 'https://x.com/IndieGameJoe/status/101' }] });

function fakeGitHub() {
  const data = { branch: false, files: new Map(), commits: 0, denyWrites: false };
  const fetchFn = async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer fixture-token');
    const path = new URL(url).pathname;
    const body = options.body ? JSON.parse(options.body) : undefined;
    if (options.method === 'GET' && path.endsWith('/git/ref/heads/video-alert-state')) return Response.json(data.branch ? { object: { sha: env.GITHUB_SHA } } : {}, { status: data.branch ? 200 : 404 });
    const filePath = path.split('/contents/')[1];
    const file = data.files.get(filePath);
    if (options.method === 'GET' && filePath) return Response.json(file ? { type: 'file', encoding: 'base64', ...file } : {}, { status: file ? 200 : 404 });
    if (data.denyWrites) return Response.json({}, { status: 403 });
    if (options.method === 'POST' && path.endsWith('/git/refs')) {
      assert.equal(body.ref, 'refs/heads/video-alert-state');
      assert.equal(body.sha, env.GITHUB_SHA);
      data.branch = true;
      return Response.json({}, { status: 201 });
    }
    if (options.method === 'PUT' && filePath) {
      if (body.sha !== file?.sha) return Response.json({}, { status: 409 });
      assert.equal(body.branch, 'video-alert-state');
      const sha = `blob-${++data.commits}`;
      data.files.set(filePath, { content: body.content, sha });
      return Response.json({ content: { sha } }, { status: 201 });
    }
    assert.fail(`unexpected mock request ${options.method} ${path}`);
  };
  return { data, fetchFn };
}

test('GitHub checkpoint survives fresh runners and excludes Discord IDs and unrelated fields', async () => {
  const { data, fetchFn } = fakeGitHub();
  const first = new GitHubStateStore(config, env, fetchFn);
  assert.equal((await first.load()).lastSeenId, null);
  await first.save(nextState());
  const persisted = Buffer.from(data.files.get('checkpoints/indiegamejoe.json').content, 'base64').toString('utf8');
  assert.equal(persisted.includes(config.channelId), false);
  assert.equal(persisted.includes(config.userId), false);
  assert.equal(persisted.includes(env.GITHUB_TOKEN), false);
  const next = new GitHubStateStore(config, env, fetchFn);
  assert.deepEqual(await next.load(), nextState());
  await next.save({ ...nextState(), pending: [] });
  assert.deepEqual((await new GitHubStateStore(config, env, fetchFn).load()).pending, []);
});

test('public checkpoint codec keeps only the explicit checkpoint fields', () => {
  const state = { ...nextState(), privateExtra: 'not-for-git' };
  state.pending[0].privateExtra = 'not-for-git';
  assert.equal(JSON.stringify(encodeCheckpoint(state, config)).includes('not-for-git'), false);
  assert.throws(() => decodeCheckpoint(encodeCheckpoint(state, config), { ...config, userId: '333333333333333333' }), /different account or Discord destination/);
});

test('concurrent checkpoint updates fail rather than overwrite newer progress', async () => {
  const { fetchFn } = fakeGitHub();
  const first = new GitHubStateStore(config, env, fetchFn);
  await first.load();
  await first.save(nextState());
  const second = new GitHubStateStore(config, env, fetchFn);
  await second.load();
  await first.save({ ...nextState(), pending: [] });
  await assert.rejects(second.save(nextState()), /HTTP 409/);
});

test('GitHub failures and corrupt saved data never silently reset a checkpoint', async () => {
  const { data, fetchFn } = fakeGitHub();
  const store = new GitHubStateStore(config, env, fetchFn);
  await store.load();
  data.denyWrites = true;
  await assert.rejects(store.save(nextState()), /HTTP 403/);
  data.branch = true;
  data.files.set('checkpoints/indiegamejoe.json', { content: Buffer.from('corrupt').toString('base64'), sha: 'blob' });
  await assert.rejects(store.load(), /corrupt/);
});

test('migrates the old checkpoint without losing pending alerts or assigning it to a new account', async () => {
  const { data, fetchFn } = fakeGitHub();
  data.branch = true;
  const legacy = { content: Buffer.from(JSON.stringify(encodeCheckpoint(nextState(), config))).toString('base64'), sha: 'legacy-blob' };
  data.files.set('checkpoint.json', legacy);
  const joe = new GitHubStateStore(config, env, fetchFn);
  assert.deepEqual(await joe.load(), nextState());
  assert.equal(joe.needsMigration, true);
  const libraryConfig = { ...config, username: 'IndieGamesLib' };
  const library = new GitHubStateStore(libraryConfig, env, fetchFn);
  assert.equal((await library.load()).lastSeenId, null);
  await library.save({ ...freshState(libraryConfig), lastSeenId: '50' });
  await joe.save(nextState());
  assert.deepEqual(data.files.get('checkpoint.json'), legacy);
  assert.equal(joe.needsMigration, false);
  assert.deepEqual(await new GitHubStateStore(config, env, fetchFn).load(), nextState());
  assert.equal((await new GitHubStateStore(libraryConfig, env, fetchFn).load()).lastSeenId, '50');
});
