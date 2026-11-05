# Run headless checks with GitHub Actions

This setup runs one headless Chrome check about every **30 minutes** from a **public repository**, then exits. Your PC can be off. GitHub creates a fresh Ubuntu runner for each job; the bot keeps its checkpoint and pending alerts in a separate `video-alert-state` branch of the same repository.

It does not keep a Discord gateway connection online continuously. The bot may appear offline between runs and can still send alerts during a check. GitHub can delay or drop scheduled runs, so 30 minutes is a requested interval, not a delivery guarantee. X may challenge or reject the runner's data-center IP, even when your cookies work locally.

GitHub's [Actions terms](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#actions) describe development workflows and restrict general application/serverless hosting. This workflow is technically prepared for scheduled checks; it is not confirmation from GitHub that ongoing operation of this notification service is permitted. Do not use a long-running loop, repeated self-dispatches, or keepalive jobs to turn Actions into a permanent server. Follow the platform's terms and any restrictions GitHub applies.

## 1. Create a public repository

On GitHub, create a **Public** repository named something like `indie-video-alerts`. If you already created a private repository, change its visibility to Public in **Settings → General → Danger Zone → Change repository visibility**. Repository visibility is a GitHub setting; the local files cannot change it. The workflow checks that the repository is public and skips its job if it is private.

The workflow uses a **standard GitHub-hosted Ubuntu runner**, whose compute usage is free in public repositories and does not consume the included private-repository compute allowance. It does not use paid larger runners, cache uploads, or artifact uploads. Keeping this configuration avoids those additional billable resources; other GitHub products you separately enable have their own pricing. [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

Use Git to publish the source. **Do not commit `.env`, `.local`, `node_modules`, or your browser profile.** They are excluded by `.gitignore`.

## 2. Add four repository secrets

Open **Settings → Secrets and variables → Actions → New repository secret**. Add:

| Secret name | Value from your working local setup |
| --- | --- |
| `DISCORD_TOKEN` | Your bot token from `.env` |
| `DISCORD_CHANNEL_ID` | Your destination channel ID from `.env` |
| `DISCORD_USER_ID` | Your user ID from `.env` |
| `X_AUTH_JSON` | The entire contents of `.local/x-auth.json`, including its outer braces |

Copy the values directly into GitHub's secret fields. Do not put them in source files, issues, workflow YAML, or chat. You do not need a personal access token: the workflow receives a scoped `GITHUB_TOKEN` automatically.

## 3. Pull and push with Git

The project repository is [keirahela/sniper](https://github.com/keirahela/sniper). GitHub does not extract ZIP uploads into a working repository; publish the actual source files with Git.

To get the project on another computer:

```powershell
git clone https://github.com/keirahela/sniper.git
Set-Location sniper
```

For updates in an existing Git checkout, first make sure your own edits are committed or safely stashed, then pull:

```powershell
git pull --ff-only origin main
```

After editing, stage the source and review the staged filenames before committing and pushing:

```powershell
git add .github src test .gitignore .dockerignore .env.example package.json package-lock.json README.md GITHUB_HOSTING.md HOSTING.md Dockerfile compose.yaml
git diff --cached --stat
git commit -m "Update video alerts"
git push origin main
```

There is nothing to pull from a completely empty repository; the initial push creates `main`. If GitHub asks you to authenticate, use your normal Git Credential Manager sign-in. Do not put an access token into the remote URL.

Confirm that this exact path exists at the repository root:

```text
.github/workflows/video-alerts.yml
```

The workflow is a repository file. Do not paste your cookies or token into it.

The `.local/github-upload.zip` bundle is an optional source backup. It is not needed for Git pushes.

## 4. Test and enable monitoring

In the repository's **Actions** tab, choose **X video alerts → Run workflow**. The mode dropdown has three choices:

| Mode | What it does |
| --- | --- |
| `check` | Reads X and prints post links. Sends nothing and does not change the checkpoint. |
| `test-discord` | Sends one real test ping to your Discord channel. Does not use X or change the checkpoint. |
| `monitor` | Performs one monitoring cycle, saves its checkpoint, and sends new video alerts. |

Run `check` first and confirm it succeeds. Run `test-discord` and confirm the ping arrives. Stop any local `npm start` process before using `monitor` so you don't have two independent monitors sending alerts.

The **first successful monitor run establishes a new GitHub baseline**, without pinging existing videos. It does not import your local checkpoint. The 30-minute schedule starts automatically once the workflow is on the public repository's default branch and repository Actions are enabled. If GitHub asks you to enable workflows, use the repository's Actions settings.

The first monitor run automatically creates the **`video-alert-state`** branch. Leave it in place. The workflow needs `contents: write` to save its checkpoint; allow that permission if repository/organisation policies restrict it. Branch protection or rulesets must allow this state branch to be updated by the workflow.

## How state and credentials are handled

- The state branch stores the latest processed post ID, queued public post links, and a hash identifying the watched account and Discord destination. It does not store your raw Discord IDs, tokens, or cookies.
- The pending queue is saved before sending to Discord. Each successful send is acknowledged immediately so a later failed job can resume. A crash between sending and acknowledgement can still cause a duplicate; Discord nonces reduce immediate duplicates.
- No commit is created when the checkpoint and queue haven't changed. X HTTP 429 responses save a cooldown that later jobs respect.
- The four secrets are injected only into the application step. Browser profiles, cookies, and `.env` files are never uploaded as artifacts or cached.
- The workflow prevents overlapping monitor jobs. The GitHub API also rejects stale checkpoint updates instead of overwriting newer progress.

## Frequency and upkeep

The schedule is `2,32 * * * *`: minutes **02 and 32** of every hour, in UTC. Scheduled jobs can be delayed or dropped under load, and public-repository schedules can be disabled after 60 days without repository activity. Check the Actions tab periodically. [GitHub schedule behaviour](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

To pause monitoring, use **Actions → X video alerts → … → Disable workflow**. To resume, enable it again. Changing `POLL_INTERVAL_SECONDS` does not affect this workflow's frequency; edit the cron expression instead.

To watch another account, edit `X_USERNAME` in the workflow. Changing the watched account or Discord destination makes the previous checkpoint incompatible. Disable the workflow first, preserve any pending alerts you need, then delete the `video-alert-state` branch to establish a fresh baseline. Do not delete it routinely.

If X rejects or expires the session, update `X_AUTH_JSON` with fresh cookies from your usual browser, then run `check` again. Keep the state branch to preserve your checkpoint. A challenge from GitHub's IP may require a different host; repeatedly retrying does not bypass X restrictions.

## Local commands

```powershell
# Read-only check through the same one-shot entry point
npm run once -- check

# One monitor cycle using local .local/state.json, then exit
npm run once

# Existing continuous local mode
npm start
```

GitHub's Ubuntu runner already includes [Google Chrome](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md), so the workflow selects `BROWSER_CHANNEL=chrome` and avoids downloading Chromium on every run.

The application and mock GitHub checkpoint API are tested locally. The repository workflow still needs its first real GitHub run; local success does not verify GitHub's IP access to X.

Vault notes consulted: **Git and Source Control for Roblox**; **HttpService and External APIs**.
