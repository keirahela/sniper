export async function runAccounts(config, run, onError = () => {}) {
  const results = [];
  const failures = [];
  // Serial checks share one session without overlapping X requests or checkpoint updates.
  for (const username of config.usernames) {
    try {
      results.push({ username, result: await run({ ...config, username }) });
    } catch (error) {
      failures.push({ username, error });
      onError(username, error);
    }
  }
  return { results, failures };
}

export function cycleMessage(username, result) {
  if (result.skipped) return `@${username}: X cooldown; next attempt after ${new Date(result.retryAfterAt).toISOString()}.`;
  if (result.baseline) return `@${username}: baseline saved from ${result.postsRead} posts; existing posts will not trigger alerts.`;
  return `@${username}: read ${result.postsRead} posts; sent ${result.alertsSent} video alert(s).`;
}
