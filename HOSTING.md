# Free hosting for continuous monitoring

If both Oracle Always Free shapes are unavailable, the [GitHub Actions guide](GITHUB_HOSTING.md) describes the prepared scheduled headless version and GitHub's limits. It does not require an Oracle account.

Use an **Oracle Cloud Always Free Ubuntu VM**. It can keep this background bot and its browser running after you turn off your PC. Card verification is required at signup. This guide prepares a deployment; it does not create a cloud account or provision a VM for you.

## What to choose

Create an account at [Oracle Cloud Free Tier](https://www.oracle.com/cloud/free/). In your **home region**, create one instance with:

| Option | Value |
| --- | --- |
| Shape | `VM.Standard.A1.Flex` (Ampere/Arm) |
| CPU | 1 OCPU |
| Memory | 6 GB |
| Image | Ubuntu 24.04 LTS, Arm-compatible |
| Boot disk | 50 GB, within your account's Always Free storage allocation |
| Networking | Public subnet with internet access and a public IP for SSH |
| SSH | Save the private key; allow SSH from your IP |

Choose an eligible configuration in the console and check its price before creating it. Select **Always Free resources**, rather than resources that are only covered by the 30-day trial. The bot needs outbound internet access; it does not need an inbound website port or a domain.

As checked on **November 5, 2026**, Oracle documents an A1 free allowance of **1,500 OCPU-hours and 9,000 GB-hours/month**, equivalent to 2 OCPUs and 12 GB continuously. The 1 OCPU / 6 GB configuration above fits within this allowance if your other resources do not consume it. Oracle includes 200 GB of Always Free block storage across the account. [Oracle Always Free resource limits](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm).

This is a practical free option, **not a guarantee of uninterrupted service**. Oracle may run out of free capacity and may reclaim idle free VMs; a lightly used bot can be affected. Free Tier has no uptime SLA. Keep a private backup of your configuration and state. [Oracle reclamation policy](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm#freetier_topic_Always_Free_Resources__idleinstances), [signup and Free Tier FAQ](https://www.oracle.com/cloud/free/faq/).

## 1. Prepare your X session on Windows

Your local cookie import and `npm run check` have already worked. Keep the existing `.env` and `.local/x-auth.json`; no additional login is needed. You can confirm access again with:

```powershell
npm run check
```

`.local/x-auth.json` contains the X cookies you saved locally (or exported with a login command). Treat this file like a password. Transfer it directly over SSH; do not upload it to GitHub, a public image registry, or chat.

Do not copy the Windows `.local/x-session` browser profile to Linux. Chromium profiles use operating-system-specific encryption. The bot imports the portable cookie export into a new Linux profile instead. A different IP or a data-center connection may still cause X to require re-verification or block the session; free hosting does not remove that limitation.

Stop a running local bot before migrating. If it has already created `.local/state.json`, transfer that file too to preserve your checkpoint and pending alerts.

## 2. Install Docker on the VM

First, from Windows PowerShell, connect using the downloaded SSH private key and the public IP shown in Oracle:

```powershell
ssh -i 'C:\path\to\your-private-key.key' ubuntu@YOUR_VM_PUBLIC_IP
```

Check that the server is the Ubuntu 24.04 VM you selected. The commands below use Docker's official Ubuntu repository for **Ubuntu 24.04 (noble)**. Run them inside that SSH session, on the VM:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

printf 'Types: deb\nURIs: https://download.docker.com/linux/ubuntu\nSuites: noble\nComponents: stable\nArchitectures: %s\nSigned-By: /etc/apt/keyrings/docker.asc\n' "$(dpkg --print-architecture)" | sudo tee /etc/apt/sources.list.d/docker.sources

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

For another Ubuntu release or a server with an existing Docker installation, use [Docker's official Ubuntu installation instructions](https://docs.docker.com/engine/install/ubuntu/). Docker supports Ubuntu 24.04 on Arm64, and Playwright supports Debian 12 / Ubuntu 24.04 on Arm64. [Playwright system requirements](https://playwright.dev/docs/intro#system-requirements).

After installation, run on the VM:

```bash
sudo systemctl enable --now docker
sudo docker compose version
mkdir -p ~/sniper/.local
chmod 700 ~/sniper/.local
```

## 3. Transfer the project and secrets

Open a second PowerShell window on your Windows PC (leave the SSH session open). Run these commands from the project folder, replacing the IP and private-key path:

```powershell
Set-Location -LiteralPath 'C:\path\to\sniper'
$botHost = 'YOUR_VM_PUBLIC_IP'
$botKey = 'C:\path\to\your-private-key.key'

scp -i $botKey Dockerfile compose.yaml .dockerignore package.json package-lock.json "ubuntu@${botHost}:~/sniper/"
scp -i $botKey -r src "ubuntu@${botHost}:~/sniper/"
scp -i $botKey .env "ubuntu@${botHost}:~/sniper/.env"
scp -i $botKey .local/x-auth.json "ubuntu@${botHost}:~/sniper/.local/x-auth.json"

# Only if you already ran the local bot and this file exists:
if (Test-Path -LiteralPath '.local/state.json') {
    scp -i $botKey .local/state.json "ubuntu@${botHost}:~/sniper/.local/state.json"
}
```

## 4. Build, check, and start

On the VM:

```bash
cd ~/sniper
chmod 600 .env .local/x-auth.json

# The container runs as uid 1000 (Node's standard non-root user).
sudo chown -R 1000:1000 /home/ubuntu/sniper/.local

sudo docker compose build
sudo docker compose run --rm bot node src/index.js --check
sudo docker compose run --rm bot node src/index.js --test-discord
sudo docker compose up -d
sudo docker compose logs -f --tail=50
```

The test command sends one real Discord ping. The check command must show readable post links before you start monitoring. Do not run check and the monitoring service simultaneously; they share a browser profile. Once the service is started, Ctrl+C exits the log viewer and leaves the bot running.

`restart: unless-stopped` restarts the container if it exits and starts it again when the VM reboots, as long as Docker is enabled. Errors inside the monitoring loop retry automatically. Persistent files stay in `~/sniper/.local`, and log rotation limits container log growth. No public application ports are exposed. Docker's restart policy cannot recover a VM reclaimed by the provider or solve an X login challenge.

## Management

```bash
# View recent activity
sudo docker compose logs --tail=50

# Stop intentionally
sudo docker compose stop

# Start again
sudo docker compose up -d

# Apply code updates after uploading changed source/package files
sudo docker compose up -d --build
```

If X requires sign-in again, stop the service, run `npm run login:native` on your PC, and transfer the new `.local/x-auth.json`. The next start imports the fresh export. Keep `.local/state.json` to preserve queued alerts and your checkpoint. Then restart the service and check its logs. A challenge tied to the server's IP may require an interactive login from that server; repeated export attempts do not bypass X restrictions.

## Why not Render Free?

Render's free web services sleep after 15 minutes without inbound requests, lose local filesystem changes on restart/spin-down, and cannot attach a persistent disk. Background workers do not have a free instance tier. Those limits do not suit this bot's browser session and checkpoint. [Render free service limitations](https://render.com/docs/free).

No host has been provisioned by this project. Docker files were prepared locally; a Linux image build and the authenticated X check must be completed on your VM.
