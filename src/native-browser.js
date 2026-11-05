import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

export async function findInstalledBrowser(env = process.env, platform = process.platform) {
  const roots = [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA].filter(Boolean);
  const candidates = platform === 'win32'
    ? roots.flatMap(root => [join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), join(root, 'Google', 'Chrome', 'Application', 'chrome.exe')])
    : platform === 'darwin'
      ? ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
      : ['/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium'];
  for (const candidate of candidates) {
    try { await access(candidate); return candidate; } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
    }
  }
  throw new Error('No installed Edge or Chrome was found. Install one, or use npm run login for bundled Chromium.');
}

export function parseDebugPort(value) {
  const port = Number(value.trim().split(/\r?\n/)[0]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('The setup browser did not report a valid local debugging port.');
  return port;
}

export async function startNativeBrowser({ executablePath, profileDirectory, url = 'https://x.com/', headless = false }) {
  await mkdir(profileDirectory, { recursive: true });
  const portFile = join(profileDirectory, 'DevToolsActivePort');
  try {
    const oldPort = parseDebugPort(await readFile(portFile, 'utf8'));
    let running = false;
    try { running = (await fetch(`http://127.0.0.1:${oldPort}/json/version`, { signal: AbortSignal.timeout(1000) })).ok; } catch {}
    if (running) throw new Error('A setup browser is already open. Close its window before running login:native again.');
    await unlink(portFile);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  // A dedicated profile keeps the user's everyday browser and its cookies separate.
  // The browser receives no Playwright launch flags; attachment happens after manual sign-in.
  const child = spawn(executablePath, [
    `--user-data-dir=${profileDirectory}`,
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    ...(headless ? ['--headless=new'] : []),
    url,
  ], { stdio: 'ignore', windowsHide: headless });
  await once(child, 'spawn');
  child.unref();
  return {
    async connect() {
      let port;
      for (let attempt = 0; attempt < 50; attempt++) {
        try { port = parseDebugPort(await readFile(portFile, 'utf8')); break; } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          await delay(100);
        }
      }
      if (!port) throw new Error('Could not connect to the setup browser. Close its window and retry after the X login restriction clears.');
      return chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true, timeout: 15000 });
    },
  };
}
