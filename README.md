# USPS Tracking Notifier

Track USPS packages via Shippo and get status notifications through Telegram.

## Features

- Add tracking numbers with optional titles via web UI or Telegram bot
- Automatic status checks on a configurable interval (default: 15 min)
- Telegram notifications when package status changes
- Telegram bot with full command support (add, edit, list, status, remove, pause, resume)
- Status history timeline per package

## Quick Start

### Prerequisites

- Node.js 22+
- PostgreSQL
- [Shippo](https://apps.goshippo.com/) account (free test key works for dev)
- [Telegram Bot Token](https://t.me/botfather)

### Setup

```bash
# 1. Clone and install
git clone <repo-url>
cd usps-tracking-notifier
npm install

# 2. Create database
createdb usps_tracking

# 3. Configure .env
cp .env.example .env
# Fill in: DATABASE_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, SHIPPO_API_KEY

# 4. Push database schema
npx prisma db push

# 5. Find your Telegram chat ID
./find-chat.sh
# Add the output to TELEGRAM_CHAT_ID in .env

# 6. Start
npm run dev
```

Open http://localhost:3000 for the web UI, or message your bot on Telegram.

## Telegram Bot Commands

| Command | Description |
|---|---|
| `/list` | List all packages (numbered) |
| `/add <tracking> [title]` | Add a package |
| `/edit [number or tracking]` | Change a package title |
| `/status <number or tracking>` | Get detailed status + history |
| `/remove <number or tracking>` | Remove a package |
| `/pause <number or tracking>` | Pause tracking |
| `/resume <number or tracking>` | Resume tracking |
| `/check` | Force check now |

Tip: use numbers from `/list`, e.g. `/status 1`

## Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token from BotFather |
| `TELEGRAM_CHAT_ID` | Your Telegram chat ID |
| `SHIPPO_API_KEY` | Shippo API key (test or live) |
| `CHECK_INTERVAL_MINUTES` | Status check interval (default: 15) |

## Tech Stack

- Next.js 14 + TypeScript + Tailwind CSS
- Prisma + PostgreSQL
- Shippo Tracking API
- Telegraf (Telegram Bot)
