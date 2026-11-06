import { dataDirectory, readConfig } from './config.js';
import { openBrowser, XBrowser } from './x-browser.js';
import { connectDiscord, recipientMentions } from './discord.js';
import { GitHubStateStore } from './github-state.js';
import { accountStateStore } from './state.js';
import { compareIds } from './posts.js';
import { runCycle } from './cycle.js';
import { runAccounts, cycleMessage } from './accounts.js';

let context;
let discord;
try {
  const mode = process.argv[2] || 'monitor';
  if (process.argv.length > 3 || !['monitor', 'check', 'test-discord'].includes(mode)) throw new Error('Use npm run once, npm run once -- check, or npm run once -- test-discord.');
  const config = readConfig(process.env, { discord: mode !== 'check' });
  if (mode === 'test-discord') {
    discord = await connectDiscord(config);
    const mentions = recipientMentions(config);
    await discord.channel.send({
      ...mentions,
      content: `${mentions.content} GitHub video alerts are connected. Watching ${config.usernames.map(name => `@${name}`).join(', ')}`,
    });
    console.log('Test ping sent.');
  } else {
    context = await openBrowser(config.headless, { channel: config.browserChannel });
    const batch = await runAccounts(config, async account => {
      const source = new XBrowser(context, account);
      if (mode === 'check') {
        const posts = await source.scan();
        for (const post of posts.sort((a, b) => compareIds(b.id, a.id))) console.log(`${post.hasVideo ? 'VIDEO' : 'other'} ${post.url}`);
        console.log(`@${account.username}: read ${posts.length} posts. No messages sent and no checkpoint changed.`);
        return;
      }
      const store = process.env.GITHUB_ACTIONS === 'true'
        ? new GitHubStateStore(account)
        : accountStateStore(dataDirectory, account);
      const result = await runCycle({
        store,
        scan: sinceId => source.scan(sinceId),
        send: async post => {
          discord ??= await connectDiscord(config);
          await discord.send(post, account);
        },
      });
      console.log(cycleMessage(account.username, result));
    }, (username, error) => console.error(`@${username}: ${error.message}`));
    if (batch.failures.length) process.exitCode = 1;
  }
} catch (error) {
  // Messages intentionally omit request bodies, cookies, and tokens.
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await context?.close();
  discord?.client.destroy();
}
