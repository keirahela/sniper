import { join } from 'node:path';
import { dataDirectory, readConfig } from './config.js';
import { openBrowser, XBrowser } from './x-browser.js';
import { connectDiscord } from './discord.js';
import { GitHubStateStore } from './github-state.js';
import { loadState, saveState } from './state.js';
import { compareIds } from './posts.js';
import { runCycle } from './cycle.js';

let context;
let discord;
try {
  const mode = process.argv[2] || 'monitor';
  if (process.argv.length > 3 || !['monitor', 'check', 'test-discord'].includes(mode)) throw new Error('Use npm run once, npm run once -- check, or npm run once -- test-discord.');
  const config = readConfig(process.env, { discord: mode !== 'check' });
  if (mode === 'test-discord') {
    discord = await connectDiscord(config);
    await discord.channel.send({
      content: `<@${config.userId}> GitHub video alerts are connected. Watching https://x.com/${config.username}`,
      allowedMentions: { parse: [], users: [config.userId] },
    });
    console.log('Test ping sent.');
  } else {
    context = await openBrowser(config.headless, { channel: config.browserChannel });
    const source = new XBrowser(context, config);
    if (mode === 'check') {
      const posts = await source.scan();
      for (const post of posts.sort((a, b) => compareIds(b.id, a.id))) console.log(`${post.hasVideo ? 'VIDEO' : 'other'} ${post.url}`);
      console.log(`Read ${posts.length} posts. No messages sent and no checkpoint changed.`);
    } else {
      const path = join(dataDirectory, 'state.json');
      const store = process.env.GITHUB_ACTIONS === 'true'
        ? new GitHubStateStore(config)
        : { load: () => loadState(path, config), save: state => saveState(path, state) };
      const result = await runCycle({
        store,
        scan: sinceId => source.scan(sinceId),
        send: async post => {
          discord ??= await connectDiscord(config);
          await discord.send(post);
        },
      });
      console.log(result.skipped ? `X rate-limit cooldown; next attempt after ${new Date(result.retryAfterAt).toISOString()}.` : result.baseline
        ? `Baseline saved from ${result.postsRead} posts. Existing posts will not trigger alerts.`
        : `Read ${result.postsRead} posts; sent ${result.alertsSent} video alert(s).`);
    }
  }
} catch (error) {
  // Messages intentionally omit request bodies, cookies, and tokens.
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await context?.close();
  discord?.client.destroy();
}
