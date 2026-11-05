import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { dataDirectory, readConfig } from './config.js';
import { connectDiscord } from './discord.js';
import { compareIds, queuePosts } from './posts.js';
import { drainPending, loadState, saveState } from './state.js';
import { openBrowser, XBrowser } from './x-browser.js';

const log = message => console.log(`${new Date().toISOString()} ${message}`);
const stopping = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stopping.abort());
let context;
let discord;
try {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--check', '--test-discord'].includes(arg)) || args.length > 1) throw new Error('Use npm start, npm run check, or npm run test:discord.');
  const checkOnly = args.includes('--check');
  const config = readConfig(process.env, { discord: !checkOnly });
  if (args.includes('--test-discord')) {
    discord = await connectDiscord(config);
    await discord.channel.send({
      content: `<@${config.userId}> Video alerts are connected. Watching https://x.com/${config.username}`,
      allowedMentions: { parse: [], users: [config.userId] },
    });
    log('Test ping sent.');
  } else {
    const path = join(dataDirectory, 'state.json');
    // Check mode is read-only: it never modifies the baseline or sends a message.
    if (!checkOnly) await loadState(path, config);
    context = await openBrowser(config.headless, { channel: config.browserChannel });
    const source = new XBrowser(context, config);
    if (checkOnly) {
      const posts = await source.scan();
      for (const post of posts.sort((a, b) => compareIds(b.id, a.id))) log(`${post.hasVideo ? 'VIDEO' : 'other'} ${post.url}`);
      log(`Read ${posts.length} recent posts. No alerts sent and no checkpoint changed.`);
    } else {
      discord = await connectDiscord(config);
      log(`Watching @${config.username}; checks every ${config.pollIntervalMs / 1000}s. Press Ctrl+C to stop.`);
      let failures = 0;
      while (!stopping.signal.aborted) {
        let waitMs = config.pollIntervalMs;
        try {
          // Reload from disk on each attempt, including after a failed save or send.
          let state = await loadState(path, config);
          state = await drainPending(state, discord.send, next => saveState(path, next));
          const firstRun = state.lastSeenId === null;
          const posts = await source.scan(state.lastSeenId);
          const next = queuePosts(state, posts);
          // Persist the checkpoint and entire outbox together before contacting Discord.
          await saveState(path, next);
          const count = next.pending.length;
          await drainPending(next, discord.send, value => saveState(path, value));
          failures = 0;
          log(firstRun ? 'Baseline saved; existing posts will not trigger alerts.' : `Check complete; ${count} video alert(s) sent.`);
        } catch (error) {
          if (stopping.signal.aborted) break;
          // Exit on a browser crash so a hosting supervisor can restart it.
          const browser = context.browser();
          if (browser && !browser.isConnected()) throw error;
          failures++;
          waitMs = Math.max(error.retryAfterMs || 0, Math.min(config.pollIntervalMs * 2 ** Math.min(failures, 8), 15 * 60 * 1000));
          log(`${error.message} Retrying in ${Math.ceil(waitMs / 1000)}s.`);
        }
        await delay(waitMs, undefined, { signal: stopping.signal }).catch(error => {
          if (error.name !== 'AbortError') throw error;
        });
      }
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await context?.close();
  discord?.client.destroy();
}
