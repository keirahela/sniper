import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

export const dataDirectory = fileURLToPath(new URL('../.local/', import.meta.url));

export function parseAccounts(values) {
  if (!Array.isArray(values) || !values.length) throw new Error('The watched account list must be a nonempty array.');
  const seen = new Set();
  return values.map(value => {
    if (typeof value !== 'string') throw new Error('Each watched account must be a username or X profile URL.');
    const username = value.trim().replace(/^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\//i, '').replace(/^@/, '').replace(/\/$/, '');
    if (!/^[a-zA-Z0-9_]{1,15}$/.test(username)) throw new Error('Each watched account must be a username or X profile URL.');
    return username;
  }).filter(username => {
    const key = username.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function readConfig(env = process.env, { discord = true } = {}) {
  let accounts;
  if (env.X_USERNAMES?.trim()) accounts = env.X_USERNAMES.split(',');
  else if (env.X_USERNAME?.trim()) accounts = [env.X_USERNAME];
  else {
    try { accounts = JSON.parse(readFileSync(new URL('../accounts.json', import.meta.url), 'utf8')); } catch {
      throw new Error('Cannot read accounts.json. It must contain a JSON array of usernames.');
    }
  }
  const usernames = parseAccounts(accounts);
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
  const userIds = [...new Set([env.DISCORD_USER_ID, ...(env.DISCORD_ADDITIONAL_USER_IDS || '').split(',')]
    .map(value => value?.trim()).filter(Boolean))];
  if (userIds.some(id => !/^\d{17,20}$/.test(id))) throw new Error('Discord recipient settings must contain valid user IDs, separated by commas.');
  const config = {
    username: usernames[0],
    usernames,
    pollIntervalMs: integer('POLL_INTERVAL_SECONDS', 120, 60, 86400) * 1000,
    maxScrolls: integer('MAX_SCROLLS', 20, 1, 200),
    includeQuotedVideos: boolean('INCLUDE_QUOTED_VIDEOS', true),
    headless: boolean('HEADLESS', true),
    browserChannel,
    discordToken: env.DISCORD_TOKEN?.trim(),
    channelId: env.DISCORD_CHANNEL_ID?.trim(),
    userId: env.DISCORD_USER_ID?.trim(),
    userIds,
  };
  if (discord) {
    if (!config.discordToken) throw new Error('Set DISCORD_TOKEN in .env first. See README.md.');
    for (const [name, value] of [['DISCORD_CHANNEL_ID', config.channelId], ['DISCORD_USER_ID', config.userId]]) {
      if (!/^\d{17,20}$/.test(value || '')) throw new Error(`Set ${name} to a Discord ID in .env. See README.md.`);
    }
  }
  return config;
}
