# OSRS Clan Bot

A Discord bot for Old School RuneScape clan management — events with reminders, leaderboards, raffles, and Skill of the Week (SOTW) competitions. Powered by the [Wise Old Man](https://wiseoldman.net) API for live XP tracking and clan data.

## Features

- **Member Linking** — Link Discord accounts to OSRS RSNs via Wise Old Man, with a rich stats card showing combat level, XP, EHP, and top skills
- **Events & Reminders** — Create one-time or recurring (weekly/monthly) events with automatic 15-minute-before reminders, RSVP buttons (Going/Maybe/Not Going), and category tags
- **Event Subscriptions** — Subscribe to event categories (boss, pvm, skilling, social, etc.) and get pinged for relevant reminders. Optional role-based pings via `/config event-role`
- **Timezone-Aware Scheduling** — Set your server timezone with `/config timezone` for accurate event time parsing using luxon
- **Raffles** — Create raffles with one-click button entry (RSN-linked members only), optional weighted draws (by SOTW wins, event attendance, or combined activity), win history, and stats
- **SOTW (Skill of the Week)** — Start skill competitions that auto-create WOM competitions, track live standings, show personal progress, queue future SOTWs, and auto-start the next when one ends
- **Leaderboards** — View clan hiscores (current XP) and top gains (XP earned over a period) for any skill, with rich embed player profiles
- **Polls** — Native Discord polls for SOTW/BOTW voting with auto-start of the winning skill
- **Clan Dashboard** — Single command showing active SOTW, upcoming events, raffles, polls, SOTW queue, and member count
- **Clan Sync** — Sync clan members from WOM with `/clan sync`, showing linked vs unlinked RSNs
- **Confirmation Flows** — Destructive actions (event cancel, SOTW end) require button confirmation
- **Pagination** — Long lists (members, events, raffles) support paginated browsing via buttons
- **Multi-Guild** — Each Discord server has its own settings, members, and events

## Setup

### 1. Prerequisites

- **Node.js 18 or newer** (the bot uses the built-in `fetch` API)

### 2. Install Dependencies

```bash
npm install
```

### 3. Create Your Discord Bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application** → give it a name
3. Go to the **Bot** tab → **Reset Token** → copy the token
4. Copy the **Application ID** from the **General Information** tab

### 4. Find Your Wise Old Man Group ID

1. Go to [wiseoldman.net/groups](https://wiseoldman.net/groups)
2. Search for your clan
3. Click on it — the group ID is the number in the URL: `wiseoldman.net/groups/123` → `123`
4. (Optional) Get your verification code: go to your group page → **Settings** → copy the verification code. This is needed for auto-creating SOTW competitions on WOM.

### 5. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and fill in:
```
DISCORD_TOKEN=your_bot_token
CLIENT_ID=your_app_id
GUILD_ID=your_server_id          # Optional, but makes commands appear instantly
WOM_GROUP_ID=your_wom_group_id
WOM_VERIFICATION_CODE=your_code   # Optional, needed for SOTW auto-creation
```

### 6. Initialize the Database

```bash
npm run init-db
```

### 7. Register Slash Commands

```bash
npm run register
```

If you set `GUILD_ID`, commands appear instantly. Otherwise, global commands can take up to 1 hour.

### 8. Start the Bot

```bash
npm start
```

### 9. Invite the Bot to Your Server

Generate an invite URL at the [Discord Developer Portal](https://discord.com/developers/applications) → your app → **OAuth2** → **URL Generator**.

Select:
- Scopes: `bot`, `applications.commands`
- Bot Permissions: `Send Messages`, `Embed Links`, `Read Message History`, `Use External Emojis`

Or use this URL (replace `CLIENT_ID`):
```
https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=277025770560&scope=bot%20applications.commands
```

## Commands

Lookups live under `/me` and `/clan`. Staff tools stay off the member slash list.

### You
| Command | Description |
|---|---|
| `/me link rsn:` | Link Discord to an OSRS RSN |
| `/me unlink` | Drop the link |
| `/me profile` · `/me balance` · `/me goals` | Stats, credits, personal goals |

### Clan
| Command | Description |
|---|---|
| `/clan info` | What’s live |
| `/clan hiscores` · `/clan gained` | WOM boards |
| `/clan members` · `/clan achievements` | Roster and 99s/KC flags |
| `/clan credits` · `/clan sync` | Guild-credit board / WOM roster sync |

### Skill / Boss of the Week
| Command | Description |
|---|---|
| `/sotw current` · `/standings` · `/me` | Live week |
| `/sotw start` optional **prize** | Staff. WOM week, not a calendar mass |
| `/sotw prize` | Stamp loot on a week already running |
| `/sotw end` · `/cancel` · `/queue` | Confirm before end/cancel/queue clear |
| `/boss week` optional **prize** | BOTW hunt |
| `/boss kc` · `/boss end` | Board / close |

### Masses
| Command | Description |
|---|---|
| `/event create` | **about** is required (world, boss, gear) |
| `/event list` · `/event cancel` | Calendar |
| `/subscribe add` | Includes masses plus SOTW and BOTW |

### Raffle / bingo / ranks
| Command | Description |
|---|---|
| `/raffle create` | **hours** or **until** required |
| `/raffle draw` · `/raffle end` | Confirm, then close |
| `/bingo create` · `/start` · `/submit` | One live board at a time |
| `/rank set` · `clear` · `who` | Woodling → Ascendant (Manage Roles) |
| `/config ranks` | Create/paint the ten Discord roles |

### Votes / mod
| Command | Description |
|---|---|
| `/vote results` · `/vote list` | Members can look |
| `/vote sotw` · `/botw` · `/generic` · `/cancel` | Admins |
| `/mod timeout` · `kick` · `ban` · `purge` | Per-action Discord permission |

## How SOTW Voting Works

The `/vote sotw` command creates a native Discord poll where members vote on the next skill. When the poll ends:

1. The bot automatically fetches the poll results from Discord
2. The winning skill is determined (ties go to the first option)
3. If auto-start is enabled (default: on), the bot immediately creates a new SOTW competition on Wise Old Man with the winning skill
4. Results and the SOTW announcement are posted to the same channel

You can control the poll duration (1-168 hours, default 24) and the SOTW duration (1-30 days, default 7). Set `auto_start` to false if you just want to poll without auto-starting.

## How SOTW Works with Wise Old Man

When you run `/sotw start`, the bot:

1. Creates a real competition on [Wise Old Man](https://wiseoldman.net) using your group ID and verification code
2. All members of your WOM group are automatically added as participants
3. WOM tracks their XP gains from the start time to end time
4. You can check live standings anytime with `/sotw standings`
5. When the SOTW ends (automatically or via `/sotw end`), the bot fetches final results and posts the top 5
6. Winners are logged in the SOTW history

The WOM API has a rate limit of 20 requests/minute (100 with an API key). The bot handles this gracefully and only fetches when you ask.

## Tech Stack

- **discord.js v14** — Discord API client
- **node:sqlite** — Built-in SQLite (no native compile step)
- **Wise Old Man API v2** — OSRS player and clan data

## File Structure

```
osrs-clan-bot/
├── src/
│   ├── index.js              # Bot entry point
│   ├── deploy-commands.js    # Slash command registration
│   ├── commands/             # Slash commands (`/me`, `/clan`, sotw, raffle, bingo, rank, mod, …)
│   ├── services/             # WOM, ranks, cards, reminders, hub ingest, economy
│   └── db/
│       ├── database.js       # SQLite
│       └── postgres.js       # Render Postgres
├── scripts/smoke.js
├── package.json
├── .env.example
├── .gitignore
└── README.md
```

## License

MIT
