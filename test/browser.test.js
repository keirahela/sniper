import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { XBrowser } from '../src/x-browser.js';
import { exportSession, importSession } from '../src/auth.js';

const tweet = (id, type = 'photo') => ({
  rest_id: id,
  core: { user_results: { result: { core: { screen_name: 'IndieGameJoe' } } } },
  legacy: { extended_entities: { media: [{ type }] } },
});
const entry = (id, type) => ({ content: { itemContent: { tweet_results: { result: tweet(id, type) } } } });
const timeline = entries => ({ data: { user: { result: { timeline_v2: { timeline: {
  instructions: [{ type: 'TimelineAddEntries', entries }],
} } } } } });

test('browser scanner captures timeline responses, paginates, and refuses errors', async t => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addCookies([{ name: 'auth_token', value: 'fixture-only', domain: '.x.com', path: '/', secure: true }]);
  let fixture = timeline([entry('103', 'video'), entry('102', 'animated_gif')]);
  let nextPage;
  let status = 200;
  let calls = 0;
  let operation = 'UserTweetsAndReplies';
  // Every request is intercepted; these tests never contact X or use a real account.
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/i/api/graphql/')) {
      calls++;
      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(url.searchParams.has('page') ? nextPage : fixture),
      });
    } else if (url.hostname === 'x.com' && url.pathname.endsWith('/with_replies')) {
      await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body>
        <script>
          async function load() {
            await fetch('/i/api/graphql/fixture/${operation}');
            document.body.insertAdjacentHTML('beforeend', '<article data-testid="tweet">Fixture</article><div style="height:10000px"></div>');
          }
          window.addEventListener('scroll', () => fetch('/i/api/graphql/fixture/${operation}?page=2'), { once: true });
          load();
        </script>
      </body></html>` });
    } else {
      await route.abort();
    }
  });
  const source = new XBrowser(context, { username: 'IndieGameJoe', includeQuotedVideos: true, maxScrolls: 1 });
  try {
    await t.test('reads exact video types from the browser response', async () => {
      const posts = await source.scan();
      assert.deepEqual(posts.map(post => [post.id, post.hasVideo]), [['103', true], ['102', false]]);
    });
    await t.test('captures the UserRepliesTimeline operation used by the live X profile', async () => {
      operation = 'UserRepliesTimeline';
      const posts = await source.scan();
      assert.deepEqual(posts.map(post => [post.id, post.hasVideo]), [['103', true], ['102', false]]);
    });
    await t.test('scrolls to retrieve missing posts before accepting catch-up', async () => {
      calls = 0;
      nextPage = timeline([entry('101', 'video'), entry('100', 'photo')]);
      const posts = await source.scan('100');
      assert.deepEqual(posts.map(post => post.id), ['103', '102', '101', '100']);
      assert.equal(calls, 2);
    });
    await t.test('fails instead of advancing when catch-up exceeds the budget', async () => {
      nextPage = fixture;
      await assert.rejects(source.scan('90'), /Could not reach the previous checkpoint/);
    });
    await t.test('reports website response schema changes', async () => {
      fixture = { unexpected: 'schema' };
      nextPage = fixture;
      await assert.rejects(source.scan(), /Could not recognize X timeline data/);
    });
    await t.test('rate limiting requests a 15-minute cooldown', async () => {
      status = 429;
      await assert.rejects(source.scan(), error => error.retryAfterMs === 900000);
    });
    await t.test('portable session export can sign a fresh browser context in', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'video-alert-session-'));
      const destination = await browser.newContext();
      try {
        const path = join(directory, 'x-auth.json');
        await exportSession(context, path);
        await importSession(destination, path);
        assert.equal((await destination.cookies('https://x.com')).find(cookie => cookie.name === 'auth_token').value, 'fixture-only');
        await assert.rejects(exportSession(await browser.newContext(), path), /unsigned X session/);
      } finally {
        await destination.close();
        assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
        await rm(directory, { recursive: true, force: true });
      }
    });
    await t.test('requires a saved signed-in session', async () => {
      await context.clearCookies();
      await assert.rejects(source.scan(), /npm run login/);
    });
    await t.test('GitHub secret JSON replaces a stale browser session without writing a cookie file', async () => {
      const serialized = JSON.stringify({ cookies: [{ name: 'auth_token', value: 'actions-fixture-only', domain: '.x.com', path: '/', secure: true }] });
      await importSession(context, 'missing-file-must-not-be-read', serialized);
      assert.equal((await context.cookies('https://x.com')).find(cookie => cookie.name === 'auth_token').value, 'actions-fixture-only');
      await assert.rejects(importSession(context, 'unused', '{private-cookie-value-invalid'), error => !error.message.includes('private-cookie-value'));
    });
  } finally {
    await context.close();
    await browser.close();
  }
});
