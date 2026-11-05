import { readFile, writeFile } from 'node:fs/promises';

export async function exportSession(context, path) {
  const cookies = await context.cookies('https://x.com');
  if (!cookies.some(cookie => cookie.name === 'auth_token' && cookie.value)) throw new Error('Cannot export an unsigned X session.');
  await writeFile(path, JSON.stringify({ cookies }, null, 2) + '\n', { mode: 0o600 });
}

export async function importSession(context, path, serialized) {
  let saved;
  try {
    saved = JSON.parse(serialized ?? await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw new Error('Cannot read X session JSON. Check X_AUTH_JSON or .local/x-auth.json.', { cause: error });
  }
  if (!Array.isArray(saved?.cookies) || !saved.cookies.some(cookie => cookie.name === 'auth_token' && cookie.value) ||
      saved.cookies.some(cookie => !['x.com', '.x.com'].includes(cookie.domain))) {
    throw new Error('Invalid X session export. Check X_AUTH_JSON or .local/x-auth.json.');
  }
  await context.addCookies(saved.cookies);
}
