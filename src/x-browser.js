import { chromium } from 'playwright';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { dataDirectory } from './config.js';
import { extractPosts, reachedCheckpoint } from './posts.js';
import { importSession } from './auth.js';

export async function openBrowser(headless, { channel } = {}) {
  await mkdir(dataDirectory, { recursive: true });
  const context = await chromium.launchPersistentContext(join(dataDirectory, 'x-session'), {
    headless,
    ...(channel ? { channel } : {}),
    viewport: { width: 1280, height: 960 },
    locale: 'en-US',
  });
  try {
    // A newly exported login must replace stale cookies already in the monitoring profile.
    await importSession(context, join(dataDirectory, 'x-auth.json'), process.env.X_AUTH_JSON);
    return context;
  } catch (error) {
    await context.close();
    throw error;
  }
}

export async function isSignedIn(context) {
  const cookies = await context.cookies('https://x.com');
  return cookies.some(cookie => cookie.name === 'auth_token' && cookie.value);
}

export class XBrowser {
  constructor(context, config) {
    this.context = context;
    this.config = config;
  }

  async scan(sinceId = null) {
    if (!await isSignedIn(this.context)) throw new Error('X login is missing. Stop the bot and run npm run login.');
    const page = await this.context.newPage();
    const posts = new Map();
    const tasks = new Set();
    const errors = [];
    let recognized = 0;
    let responses = 0;
    const capture = response => {
      const url = new URL(response.url());
      if (url.hostname !== 'x.com' || !/\/(?:UserTweets(?:AndReplies)?|UserRepliesTimeline)$/.test(url.pathname)) return;
      const task = (async () => {
        responses++;
        if (response.status() === 429) {
          const error = new Error('X is rate limiting this session; pausing for at least 15 minutes.');
          error.retryAfterMs = 15 * 60 * 1000;
          throw error;
        }
        if (!response.ok()) throw new Error(`X timeline returned HTTP ${response.status()}. Try npm run login if this persists.`);
        const result = extractPosts(await response.json(), this.config.username, this.config.includeQuotedVideos);
        recognized += result.recognizedTweets;
        for (const post of result.posts) {
          const previous = posts.get(post.id);
          posts.set(post.id, { ...post, pinned: post.pinned && previous?.pinned !== false });
        }
      })().catch(error => errors.push(error)).finally(() => tasks.delete(task));
      tasks.add(task);
    };
    page.on('response', capture);
    try {
      // Detection uses timeline metadata; avoid downloading videos and images on the VM.
      await page.route('**/*', route => ['image', 'media', 'font'].includes(route.request().resourceType()) ? route.abort() : route.fallback());
      await page.goto(`https://x.com/${this.config.username}/with_replies`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      // Waiting for a tweet also allows X's JavaScript application to finish loading.
      try {
        await page.locator('article[data-testid="tweet"]').first().waitFor({ timeout: 30000 });
      } catch {
        await Promise.all([...tasks]);
        if (errors.length) throw errors[0];
        throw new Error('X did not show a timeline. Stop the bot, run npm run login, and check the profile for login prompts, challenges, or unavailable posts.');
      }
      for (let scroll = 0; scroll <= this.config.maxScrolls; scroll++) {
        await Promise.all([...tasks]);
        if (errors.length) throw errors[0];
        const collected = [...posts.values()];
        if (collected.length && (sinceId === null || reachedCheckpoint(collected, sinceId))) return collected;
        if (scroll === this.config.maxScrolls) break;
        await page.evaluate(() => window.scrollBy(0, Math.floor(window.innerHeight * 0.8)));
        await delay(1500);
      }
      if (!recognized || !responses) throw new Error('Could not recognize X timeline data. The website format may have changed; no checkpoint was advanced.');
      throw new Error(`Could not reach the previous checkpoint within ${this.config.maxScrolls} scrolls. Increase MAX_SCROLLS and retry; no posts were skipped.`);
    } finally {
      page.off('response', capture);
      await page.close();
      await Promise.all([...tasks]);
    }
  }
}
