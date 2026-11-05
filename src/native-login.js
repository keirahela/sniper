import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { join } from 'node:path';
import { readConfig, dataDirectory } from './config.js';
import { exportSession } from './auth.js';
import { isSignedIn } from './x-browser.js';
import { findInstalledBrowser, startNativeBrowser } from './native-browser.js';

let terminal;
let browser;
try {
  const config = readConfig(process.env, { discord: false });
  const executablePath = await findInstalledBrowser();
  console.log(`Opening your installed browser: ${executablePath}`);
  console.log('If X temporarily limited your login, stop here and wait for the restriction to clear before trying again.');
  const setup = await startNativeBrowser({ executablePath, profileDirectory: join(dataDirectory, 'x-native-login') });
  console.log('Sign in to X manually in this dedicated browser window. The bot will connect only after you press Enter.');
  console.log('Use the X username/email and X password form. Google sign-in may reject the setup browser.');
  console.log('If you only used Google before, create an X password through X\'s official Forgot password flow in your regular browser after the login lock clears.');
  terminal = createInterface({ input: stdin, output: stdout });
  await terminal.question('Once you are signed in and can see your X home page, press Enter here: ');
  browser = await setup.connect();
  const context = browser.contexts()[0];
  if (!context || !await isSignedIn(context)) throw new Error('No signed-in X session was found. If login is limited, wait for X to clear it before trying again.');
  const page = await context.newPage();
  await page.goto(`https://x.com/${config.username}/with_replies`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.locator('article[data-testid="tweet"]').first().waitFor({ timeout: 45000 });
  await exportSession(context, join(dataDirectory, 'x-auth.json'));
  console.log('Session saved. Close the dedicated setup browser window, then run npm run check.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  terminal?.close();
  // For a CDP attachment this disconnects Playwright; the user closes their setup window.
  await browser?.close();
}
