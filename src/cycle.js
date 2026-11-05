import { queuePosts } from './posts.js';
import { drainPending } from './state.js';

export async function runCycle({ store, scan, send, now = Date.now }) {
  let state = await store.load();
  if (state.retryAfterAt > now()) return { skipped: true, retryAfterAt: state.retryAfterAt, baseline: false, postsRead: 0, alertsSent: 0 };
  let alertsSent = 0;
  const deliver = async post => { await send(post); alertsSent++; };
  const save = next => store.save(next);
  state = await drainPending(state, deliver, save);
  const baseline = state.lastSeenId === null;
  let posts;
  try {
    posts = await scan(state.lastSeenId);
  } catch (error) {
    if (Number.isFinite(error.retryAfterMs) && error.retryAfterMs > 0) await save({ ...state, retryAfterAt: Math.ceil(now() + error.retryAfterMs) });
    throw error;
  }
  const next = queuePosts(state, posts);
  delete next.retryAfterAt;
  // Save all pending alerts before sending; acknowledge each successful send durably.
  if (store.needsMigration || JSON.stringify(next) !== JSON.stringify(state)) await save(next);
  await drainPending(next, deliver, save);
  return { baseline, postsRead: posts.length, alertsSent };
}
