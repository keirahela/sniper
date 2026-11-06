import { setTimeout as delay } from 'node:timers/promises';
import { dataDirectory, readConfig } from './config.js';
import { connectDiscord, recipientMentions } from './discord.js';
import { compareIds } from './posts.js';
import { accountStateStore } from './state.js';
import { openBrowser, XBrowser } from './x-browser.js';
import { runCycle } from './cycle.js';
import { runAccounts, cycleMessage } from './accounts.js';

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
    const mentions = recipientMentions(config);
    await discord.channel.send({
      ...mentions,
      content: `${mentions.content} Video alerts are connected. Watching ${config.usernames.map(name => `@${name}`).join(', ')}`,
    });
    log('Test ping sent.');
  } else {
    context = await openBrowser(config.headless, { channel: config.browserChannel });
    const stores = new Map(config.usernames.map(username => [username, accountStateStore(dataDirectory, { ...config, username })]));
    if (checkOnly) {
      const batch = await runAccounts(config, async account => {
        const posts = await new XBrowser(context, account).scan();
        for (const post of posts.sort((a, b) => compareIds(b.id, a.id))) log(`${post.hasVideo ? 'VIDEO' : 'other'} ${post.url}`);
        log(`@${account.username}: read ${posts.length} recent posts. No alerts sent and no checkpoint changed.`);
      }, (username, error) => log(`@${username}: ${error.message}`));
      if (batch.failures.length) process.exitCode = 1;
    } else {
      discord = await connectDiscord(config);
      log(`Watching ${config.usernames.map(name => `@${name}`).join(', ')}; checks every ${config.pollIntervalMs / 1000}s. Press Ctrl+C to stop.`);
      const retry = new Map();
      while (!stopping.signal.aborted) {
        const batch = await runAccounts(config, async account => {
          if (stopping.signal.aborted || (retry.get(account.username)?.after || 0) > Date.now()) return;
          const result = await runCycle({
            store: stores.get(account.username),
            scan: sinceId => new XBrowser(context, account).scan(sinceId),
            send: post => discord.send(post, account),
          });
          retry.delete(account.username);
          log(cycleMessage(account.username, result));
        }, (username, error) => {
          if (stopping.signal.aborted) return;
          const failures = (retry.get(username)?.failures || 0) + 1;
          const waitMs = Math.max(error.retryAfterMs || 0, Math.min(config.pollIntervalMs * 2 ** Math.min(failures, 8), 15 * 60 * 1000));
          retry.set(username, { failures, after: Date.now() + waitMs });
          log(`@${username}: ${error.message} Retrying after ${Math.ceil(waitMs / 1000)}s.`);
        });
        const browser = context.browser();
        if (batch.failures.length && browser && !browser.isConnected()) throw batch.failures[0].error;
        await delay(config.pollIntervalMs, undefined, { signal: stopping.signal }).catch(error => {
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
