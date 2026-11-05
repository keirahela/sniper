import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { findInstalledBrowser, parseDebugPort, startNativeBrowser } from '../src/native-browser.js';

test('debugging port parsing rejects malformed endpoints', () => {
  assert.equal(parseDebugPort('54321\n/devtools/browser/fixture\n'), 54321);
  for (const value of ['', '0', '65536', 'http://example.com', 'NaN']) assert.throws(() => parseDebugPort(value));
});

test('native login can attach to an independently started browser and export a session', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'video-native-login-'));
  const executablePath = process.platform === 'win32' ? await findInstalledBrowser() : chromium.executablePath();
  let browser;
  try {
    const setup = await startNativeBrowser({ executablePath, profileDirectory: directory, headless: true, url: 'about:blank' });
    browser = await setup.connect();
    const context = browser.contexts()[0];
    // No X navigation, real login, or real account cookies are used in this test.
    await context.addCookies([{ name: 'auth_token', value: 'native-fixture-only', domain: '.x.com', path: '/', secure: true }]);
    assert.equal((await context.cookies('https://x.com')).find(cookie => cookie.name === 'auth_token').value, 'native-fixture-only');
    await assert.rejects(startNativeBrowser({ executablePath, profileDirectory: directory, headless: true, url: 'about:blank' }), /already open/);
  } finally {
    if (browser) {
      const cdp = await browser.newBrowserCDPSession();
      await cdp.send('Browser.close');
      await browser.close();
    }
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
