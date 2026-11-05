import { createHash } from 'node:crypto';
import { freshState, validateState } from './state.js';

export const stateScope = config => createHash('sha256')
  .update(JSON.stringify([config.username.toLowerCase(), config.channelId, config.userId])).digest('hex');

export function encodeCheckpoint(state, config) {
  validateState(state, config);
  // This file may be public. Never include cookies, tokens, or raw Discord IDs.
  return {
    version: 1,
    scope: stateScope(config),
    lastSeenId: state.lastSeenId,
    pending: state.pending.map(({ id, url }) => ({ id, url })),
    ...(state.retryAfterAt !== undefined ? { retryAfterAt: state.retryAfterAt } : {}),
  };
}

export function decodeCheckpoint(saved, config) {
  if (saved?.version !== 1 || saved.scope !== stateScope(config)) {
    throw new Error('GitHub checkpoint belongs to a different account or Discord destination. See GITHUB_HOSTING.md before resetting it.');
  }
  return validateState({
    ...freshState(config), lastSeenId: saved.lastSeenId, pending: saved.pending,
    ...(saved.retryAfterAt !== undefined ? { retryAfterAt: saved.retryAfterAt } : {}),
  }, config);
}

export class GitHubStateStore {
  constructor(config, env = process.env, fetchFn = fetch) {
    if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(env.GITHUB_REPOSITORY || '') || !env.GITHUB_TOKEN || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || '')) {
      throw new Error('GitHub Actions requires GITHUB_REPOSITORY, GITHUB_TOKEN, and GITHUB_SHA.');
    }
    this.config = config;
    this.token = env.GITHUB_TOKEN;
    this.commit = env.GITHUB_SHA;
    this.base = `https://api.github.com/repos/${env.GITHUB_REPOSITORY}`;
    this.branch = 'video-alert-state';
    this.path = `checkpoints/${config.username.toLowerCase()}.json`;
    this.fetch = fetchFn;
    this.sha = undefined;
    this.branchExists = false;
    this.needsMigration = false;
  }

  async request(method, path, body, allowMissing = false) {
    const response = await this.fetch(`${this.base}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2026-03-10',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30000),
    });
    if (response.status === 404 && allowMissing) return null;
    if (!response.ok) {
      throw new Error(`GitHub checkpoint API returned HTTP ${response.status}. Allow contents: write and permit updates to the video-alert-state branch.`);
    }
    return response.json();
  }

  async load() {
    const reference = await this.request('GET', `/git/ref/heads/${this.branch}`, undefined, true);
    this.branchExists = reference !== null;
    this.sha = undefined;
    this.needsMigration = false;
    if (!this.branchExists) return freshState(this.config);
    let file = await this.request('GET', `/contents/${this.path}?ref=${this.branch}`, undefined, true);
    if (!file) {
      // Preserve the existing single-account deployment; never reuse it for a new account.
      file = await this.request('GET', `/contents/checkpoint.json?ref=${this.branch}`, undefined, true);
      if (!file) return freshState(this.config);
      this.needsMigration = true;
    }
    if (file.type !== 'file' || file.encoding !== 'base64' || typeof file.content !== 'string' || typeof file.sha !== 'string') {
      throw new Error('GitHub checkpoint has an unexpected format; refusing to reset it.');
    }
    let decoded;
    try { decoded = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')); } catch {
      throw new Error('GitHub checkpoint is corrupt; refusing to reset it.');
    }
    if (this.needsMigration && decoded.scope !== stateScope(this.config)) {
      this.needsMigration = false;
      return freshState(this.config);
    }
    if (!this.needsMigration) this.sha = file.sha;
    return decodeCheckpoint(decoded, this.config);
  }

  async save(state) {
    const content = Buffer.from(JSON.stringify(encodeCheckpoint(state, this.config), null, 2) + '\n').toString('base64');
    if (!this.branchExists) {
      await this.request('POST', '/git/refs', { ref: `refs/heads/${this.branch}`, sha: this.commit });
      this.branchExists = true;
    }
    const result = await this.request('PUT', `/contents/${this.path}`, {
      message: 'Save video alert checkpoint',
      content,
      branch: this.branch,
      ...(this.sha ? { sha: this.sha } : {}),
    });
    if (typeof result?.content?.sha !== 'string') throw new Error('GitHub did not confirm checkpoint persistence; alerts were not acknowledged.');
    this.sha = result.content.sha;
    this.needsMigration = false;
  }
}
