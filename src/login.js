import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { join } from 'node:path';
import { dataDirectory, readConfig } from './config.js';
import { exportSession } from './auth.js';
import { isSignedIn, openBrowser } from './x-browser.js';

let context;
let terminal;
try {
  const config = readConfig(process.env, { discord: false });
  context = await openBrowser(false);
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto('https://x.com/i/flow/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('Sign in to X in the browser window. Your session stays in .local/x-session on this computer.');
  console.log('Use the X username/email and X password form. Google sign-in may reject the setup browser.');
  console.log('If X temporarily locked sign-in, close this window and wait for the lock to clear before trying again.');
  terminal = createInterface({ input: stdin, output: stdout });
  await terminal.question('After completing sign-in, press Enter here: ');
  if (!await isSignedIn(context)) throw new Error('No signed-in X session was found. Run npm run login again and complete sign-in first.');
  await page.goto(`https://x.com/${config.username}/with_replies`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.locator('article[data-testid="tweet"]').first().waitFor({ timeout: 45000 });
  await exportSession(context, join(dataDirectory, 'x-auth.json'));
  console.log(`Session saved and @${config.username}'s timeline is visible. You can now run npm start.`);
  console.log('A portable session export is in .local/x-auth.json for private transfer to your server. Keep it secret.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  terminal?.close();
  await context?.close();
}
