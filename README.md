# IndieGameJoe video alerts

A discord.js bot that pings your user in a private Discord server when **@IndieGameJoe publishes a new X post with a video**, with a direct link to that post. The watched username is configurable.

This version needs **no paid X API, third-party monitoring service, or API key**. Playwright opens X using a dedicated local browser session you sign in to yourself. Your computer must stay on and connected to the internet while the bot runs locally. For scheduled headless checks with your PC off, see [the GitHub Actions setup](GITHUB_HOSTING.md). The [Oracle VM guide](HOSTING.md) is another option when Always Free capacity is available.

## Setup on Windows

Use Node.js **24.17 or newer**. In PowerShell, from this folder:

```powershell
npm install
npm run browser:install
Copy-Item .env.example .env
```

If `.env` already exists, edit it instead of copying over it.

### 1. Create your Discord bot

1. Open the [Discord Developer Portal](https://discord.com/developers/applications), create an application, and open its **Bot** settings.
2. Copy the bot token (use **Reset Token** if needed) into `DISCORD_TOKEN` in `.env`. Keep the token private; do not send it in chat.
3. Under **Installation** or **OAuth2 → URL Generator**, create a server install link with the `bot` scope and **View Channels**, **Send Messages**, and **Embed Links** permissions. Open the link and add the bot to your private server. It does not need Administrator or privileged gateway intents.
4. In Discord, enable **User Settings → Advanced → Developer Mode**. Right-click the destination text channel and choose **Copy Channel ID**; put it in `DISCORD_CHANNEL_ID`. Right-click your user and choose **Copy User ID**; put it in `DISCORD_USER_ID`.
5. Make sure the bot can view and send messages in that channel, and your user is a member of the server. Keep the channel private using Discord's channel permissions. The bot does not change server permissions.

Your `.env` needs these three values:

```dotenv
DISCORD_TOKEN=your_bot_token
DISCORD_CHANNEL_ID=your_text_channel_id
DISCORD_USER_ID=your_user_id
X_USERNAME=IndieGameJoe
```

### 2. Sign in to X once

On Windows, use your installed Edge or Chrome:

```powershell
npm run login:native
```

A dedicated window of your installed browser opens with a separate profile in `.local/x-native-login`. Complete X sign-in yourself, including any verification. Return to the terminal and press Enter. The bot connects to the browser only then, confirms that the watched profile is readable, and saves `.local/x-auth.json`. Close the dedicated setup browser afterward. It never asks for your password in the terminal. The local debugging connection is bound to loopback.

`npm run login` is still available as a fallback using Playwright's bundled Chromium.

Stop the bot before signing in again so the next start imports the new session export.

### 3. Check both connections

```powershell
npm run check
npm run test:discord
```

`check` reads recent posts and prints `VIDEO` or `other` with their links. It needs only the X session, sends nothing, and does not change your alert checkpoint. Use the output to compare detection against the actual profile.

`test:discord` sends one real test ping to your configured channel. It does not use X or change the checkpoint.

### 4. Start monitoring

```powershell
npm start
```

The **first successful check sets a baseline**, so existing videos do not flood your channel. From then on, a new matching post produces:

```text
@you New video post from @IndieGameJoe
https://x.com/IndieGameJoe/status/1234567890123456789
```

The default interval is **120 seconds**, plus the time to load the page. Ctrl+C stops the bot. Keep the process running and prevent the computer from sleeping for continuous monitoring. Discord's notification and Do Not Disturb settings still control whether a ping produces a phone/desktop notification.

## What counts as a match

- A newly published post or reply authored by the watched account with native X video media.
- A newly published quote post containing a video, including a video in the quoted post, when `INCLUDE_QUOTED_VIDEOS=true` (the default).
- Photos, text-only posts, native animated GIF attachments, and reposts are ignored.
- Links to external videos, such as YouTube links without native X video media, do not count.
- One ping per matching post, even if it contains several videos.
- Adding video to an already processed post through an edit is not treated as a new post.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `X_USERNAME` | `IndieGameJoe` | Username, `@username`, or profile URL |
| `POLL_INTERVAL_SECONDS` | `120` | Delay between completed checks; minimum 60 |
| `MAX_SCROLLS` | `20` | Scroll budget to catch up to the previous checkpoint |
| `INCLUDE_QUOTED_VIDEOS` | `true` | Include video media inside quote posts |
| `HEADLESS` | `true` | Set to `false` to inspect the monitoring browser |
| `BROWSER_CHANNEL` | bundled Chromium | Optional `chrome`, `msedge`, or `chromium`; Actions uses installed Chrome |

`npm run once` performs one monitoring cycle and exits. On GitHub Actions it persists its queue to the `video-alert-state` branch; locally it uses the same `.local/state.json` as continuous mode. See [GitHub setup](GITHUB_HOSTING.md) for credentials and scheduling.

The prepared GitHub workflow runs in a **public repository every 30 minutes**, using free standard GitHub-hosted runner compute. Credentials stay in GitHub Secrets.

## Reliability and local data

X does not provide a stable, supported browser scraping interface. This bot reads the timeline responses that X's own website loads; it does not call paid API endpoints. Website changes, login challenges, session expiry, missing/deleted posts, account restrictions, and rate limits can interrupt or limit monitoring. This is a best-effort free solution, and it needs a real signed-in check on your machine before relying on it. There is no CAPTCHA bypass or stealth browser configuration.

Errors appear in the terminal and trigger increasing delays, up to 15 minutes. X HTTP 429 responses pause checks for at least 15 minutes. If the previous checkpoint cannot be reached within the scroll budget, the bot leaves it unchanged and reports an error; increase `MAX_SCROLLS` after a long outage. It cannot recover posts that X no longer serves.

The bot saves its checkpoint and pending alerts together in `.local/state.json`. Failed sends remain queued and are retried before another X scan. Discord nonces reduce immediate duplicate sends; a crash after sending but before saving can still cause a duplicate later. Run only one monitoring process per project folder.

`.env` and `.local/` are excluded from Git. **The browser profiles and `.local/x-auth.json` contain your signed-in X session**; keep them private along with your Discord token. To forget the session, stop the bot, close the setup window, and remove `.local/x-session`, `.local/x-native-login`, and `.local/x-auth.json`. To start a new baseline, stop the bot and move `.local/state.json` aside; doing so also discards its pending alerts. Changing the watched account or Discord destination requires a fresh baseline.

If X asks you to log in again, stop the bot and run `npm run login:native`. If monitoring Chromium is missing, run `npm run browser:install`.

If X says **“We’ve temporarily limited your login”**, stop retrying. The message alone does not establish whether the cause is your browser, account, or connection. For locks caused by repeated failed attempts, X says the restriction usually lasts about an hour. Wait, confirm that you can sign in normally, then try the native login command. A browser change does not lift an account restriction. [X's temporary login lock guidance](https://help.x.com/en/managing-your-account/locked-out-after-too-many-login-attempts).

If **Sign in with Google** shows **“This browser or app may not be secure”** (Hungarian: **“Lehetséges, hogy ez a böngésző vagy alkalmazás nem biztonságos”**), that is a separate sign-in issue. Google may reject browsers controlled by software, among other causes. Using an installed browser does not guarantee that Google will accept the setup window. [Google's supported-browser guidance](https://support.google.com/accounts/answer/7675428?hl=en).

First close the setup windows and stop login attempts for about an hour. Confirm that X sign-in works in your usual browser before running a setup command again. If the X lock persists, follow X's recovery guidance; retrying the bot setup cannot clear it.

Once access is restored, use X's own **username/email and X password** form in the setup window. This does not require Google sign-in. If you created the X account using Google and never set an X password, X documents creating one through its official **Forgot password** flow. Do that in your usual browser first. Use an X password, not your Google password. Password resets sign out existing X sessions, so run setup again afterward to save a new session. [X single-sign-on guidance](https://help.x.com/en/managing-your-account/sso), [X password recovery](https://help.x.com/en/managing-your-account/forgotten-or-lost-password-reset).

The replies feed currently uses the website operation `UserRepliesTimeline`, which the bot supports alongside `UserTweets` and `UserTweetsAndReplies`. If you see **“Could not recognize X timeline data”**, the session may still be working; the bot may need an update for a changed website operation or response format. This error leaves the alert checkpoint unchanged.

## Validation

```powershell
npm test
```

The tests cover video filtering, quoted videos, GIF/repost exclusion, pinned posts, large post IDs, first-run behavior, checkpointing, failed-send recovery, local persistence, safe mentions, and parsing timeline fixtures in a real Chromium browser. Live X login and Discord delivery require your credentials and are checked using the setup commands above.

Implementation references: [Playwright persistent browser contexts](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context), [browser installation](https://playwright.dev/docs/browsers), [discord.js](https://discord.js.org/docs/packages/discord.js/14.28.1), [Discord allowed mentions](https://docs.discord.com/developers/resources/message#allowed-mentions-object). The [official X API uses paid credits](https://docs.x.com/x-api/getting-started/pricing); this project uses the browser approach to meet the free requirement.

Vault notes consulted: **HttpService and External APIs**; **Discord Servers for Roblox Games**.
