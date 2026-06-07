# Package Tracking Notifier

Track USPS and FedEx packages — get Telegram notifications when status changes. No API keys required.

## Features

- Track USPS and FedEx packages via web UI or Telegram bot
- Auto-detect carrier from tracking number format (20-22 digits = USPS, 12+ digits = FedEx)
- Automatic status checks on a configurable interval (default: 15 min)
- Telegram notifications only when a package's status actually changes — no duplicate pings
- Fuzzy matching on commands (`/lsit` → suggests `/list`) and tracking numbers/names
- Clickable tracking numbers in Telegram — tap to open the carrier's tracking page
- Web UI with carrier-specific gradient cards, status history timeline, and direct tracking links
- Pause/resume individual packages, edit titles, inline notes

## Quick Start

### Prerequisites

- Node.js 22+
- PostgreSQL
- [Telegram Bot Token](https://t.me/botfather)

### Setup

```bash
git clone https://github.com/ai-armageddon/package-tracker.git
cd package-tracker
npm install

# Create database
createdb usps_tracking

# Configure
cp .env.example .env
# Fill in: DATABASE_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

# Setup database
npx prisma db push

# Find your Telegram chat ID (send any message to your bot first)
./find-chat.sh
# Copy the chat ID into TELEGRAM_CHAT_ID in .env

# Start
npm run dev
```

Open http://localhost:3000 for the web UI, or message your bot on Telegram.

## Telegram Bot Commands

| Command | Description |
|---|---|
| `/list` | List all packages with index, status, carrier, and clickable tracking numbers |
| `/add <tracking> [title]` | Add a package (auto-detects carrier by format) |
| `/add usps\|fedex <tracking> [title]` | Add with explicit carrier |
| `/edit [number or tracking]` | Change a package title (shows package list if no arg) |
| `/status <number or tracking>` | Get detailed status + recent history |
| `/remove <number or tracking>` | Remove a package |
| `/pause <number or tracking>` | Pause tracking for a package |
| `/resume <number or tracking>` | Resume tracking for a package |
| `/check` | Force check all packages now + auto-list results |

Use numbers from `/list` (e.g. `/status 1`) or partial names — fuzzy matching finds the closest match if you mistype.

## Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token from BotFather |
| `TELEGRAM_CHAT_ID` | Your Telegram chat ID |
| `CHECK_INTERVAL_MINUTES` | Status check interval (default: 15) |

## How Tracking Works

No external API keys needed. The app uses Puppeteer with a stealth plugin to render carrier tracking pages like a real browser, then extracts status, location, and timeline events from the page. A 3-second cooldown between requests avoids triggering bot detection. Each check opens Chrome once per carrier, processes all packages, then closes — keeping resource usage low.

## Supported Carriers

| Carrier | Tracking Number Format | Tracking URL |
|---|---|---|
| USPS | 20–22 digits | tools.usps.com |
| FedEx | 12+ digits or DT+12 digits | fedex.com |

## Tech Stack

- Next.js 14 + TypeScript + Tailwind CSS
- Prisma + PostgreSQL
- Puppeteer + Stealth plugin (carrier page scraping)
- Telegraf (Telegram bot)
