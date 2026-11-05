import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export function freshState(config) {
  return { version: 1, username: config.username.toLowerCase(), channelId: config.channelId, userId: config.userId, lastSeenId: null, pending: [] };
}

export async function loadState(path, config) {
  let state;
  try {
    state = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return freshState(config);
    throw new Error('Cannot read saved state. Restore .local/state.json from a backup or move it aside to start a new baseline.', { cause: error });
  }
  return validateState(state, config);
}

export function accountStateStore(directory, config) {
  const path = join(directory, 'accounts', `${config.username.toLowerCase()}.json`);
  const legacyPath = join(directory, 'state.json');
  return {
    needsMigration: false,
    async load() {
      try {
        await readFile(path, 'utf8');
        this.needsMigration = false;
        return await loadState(path, config);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      let legacy;
      try { legacy = JSON.parse(await readFile(legacyPath, 'utf8')); } catch (error) {
        if (error.code === 'ENOENT') return freshState(config);
        throw new Error('Cannot read the old local checkpoint; refusing to discard it.', { cause: error });
      }
      if (legacy?.username !== config.username.toLowerCase()) return freshState(config);
      this.needsMigration = true;
      return validateState(legacy, config);
    },
    async save(state) {
      await saveState(path, state);
      this.needsMigration = false;
    },
  };
}

export function validateState(state, config) {
  const expected = freshState(config);
  for (const key of ['version', 'username', 'channelId', 'userId']) {
    if (state?.[key] !== expected[key]) throw new Error('Saved state belongs to a different account or Discord destination. Move .local/state.json aside to start a new baseline.');
  }
  if (state.retryAfterAt !== undefined && (!Number.isSafeInteger(state.retryAfterAt) || state.retryAfterAt < 0)) {
    throw new Error('Saved retry time is invalid; refusing to reset it automatically.');
  }
  if (!(state.lastSeenId === null || (typeof state.lastSeenId === 'string' && /^\d+$/.test(state.lastSeenId))) ||
      !Array.isArray(state.pending) || state.pending.some(post => typeof post?.id !== 'string' || !/^\d+$/.test(post.id) || typeof post.url !== 'string' || post.url.toLowerCase() !== `https://x.com/${config.username}/status/${post.id}`.toLowerCase())) {
    throw new Error('Saved state is invalid; refusing to reset it automatically.');
  }
  return state;
}

export async function saveState(path, state) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  await rename(temporary, path);
}

export async function drainPending(state, send, save) {
  let current = state;
  while (current.pending.length) {
    await send(current.pending[0]);
    const next = { ...current, pending: current.pending.slice(1) };
    await save(next);
    current = next;
  }
  return current;
}
