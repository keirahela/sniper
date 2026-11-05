import { fileURLToPath } from 'node:url';

export const dataDirectory = fileURLToPath(new URL('../.local/', import.meta.url));

export function readConfig(env = process.env, { discord = true } = {}) {
  let username = (env.X_USERNAME || 'IndieGameJoe').trim();
  username = username.replace(/^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\//i, '').replace(/^@/, '').replace(/\/$/, '');
  if (!/^[a-zA-Z0-9_]{1,15}$/.test(username)) throw new Error('X_USERNAME must be a username or X profile URL.');
  function integer(name, fallback, minimum, maximum) {
    const value = Number(env[name] || fallback);
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
    }
    return value;
  }
  function boolean(name, fallback) {
    const value = env[name]?.trim() || String(fallback);
    if (!['true', 'false'].includes(value)) throw new Error(`${name} must be true or false.`);
    return value === 'true';
  }
  const browserChannel = env.BROWSER_CHANNEL?.trim() || undefined;
  if (browserChannel && !['chromium', 'chrome', 'msedge'].includes(browserChannel)) throw new Error('BROWSER_CHANNEL must be chromium, chrome, or msedge.');
  const config = {
    username,
    pollIntervalMs: integer('POLL_INTERVAL_SECONDS', 120, 60, 86400) * 1000,
    maxScrolls: integer('MAX_SCROLLS', 20, 1, 200),
    includeQuotedVideos: boolean('INCLUDE_QUOTED_VIDEOS', true),
    headless: boolean('HEADLESS', true),
    browserChannel,
    discordToken: env.DISCORD_TOKEN?.trim(),
    channelId: env.DISCORD_CHANNEL_ID?.trim(),
    userId: env.DISCORD_USER_ID?.trim(),
  };
  if (discord) {
    if (!config.discordToken) throw new Error('Set DISCORD_TOKEN in .env first. See README.md.');
    for (const [name, value] of [['DISCORD_CHANNEL_ID', config.channelId], ['DISCORD_USER_ID', config.userId]]) {
      if (!/^\d{17,20}$/.test(value || '')) throw new Error(`Set ${name} to a Discord ID in .env. See README.md.`);
    }
  }
  return config;
}
