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

### Member
| Command | Description |
|---|---|
| `/member link rsn:<name>` | Link your Discord to your OSRS RSN |
| `/member unlink` | Remove your RSN link |
| `/member whois user:@user` | Look up someone's RSN |
| `/member list` | List all linked members |

### Events
| Command | Description |
|---|---|
| `/event create title:<t> datetime:<dt> recurring:<weekly/monthly>` | Create an event (auto-reminds 15 min before) |
| `/event list` | Show upcoming events |
| `/event cancel id:#` | Cancel an event |
| `/event remind id:#` | Send a manual reminder |

### Raffles
| Command | Description |
|---|---|
| `/raffle create title:<t>` | Create a raffle with button entry (RSN-linked only) |
| `/raffle entries id:#` | Check entry count |
| `/raffle draw id:#` | Draw a random winner |
| `/raffle list` | List all raffles |
| `/raffle history [user:@user]` | Show raffle win stats or server leaderboard |

### SOTW (Skill of the Week)
| Command | Description |
|---|---|
| `/sotw start skill:<skill>` | Start a SOTW (auto-creates WOM competition) |
| `/sotw standings` | Show live standings from WOM |
| `/sotw current` | Show the active SOTW |
| `/sotw me` | Show your personal progress in the current SOTW |
| `/sotw champions` | Show cumulative SOTW win leaderboard |
| `/sotw end` | End SOTW and post results |
| `/sotw history` | Show past SOTW winners |
| `/sotw update` | Force update WOM participant data |

### Leaderboard
| Command | Description |
|---|---|
| `/leaderboard hiscores skill:<skill>` | Top clan members by current XP |
| `/leaderboard gained skill:<skill> period:<p>` | Top XP gained (day/week/month/year) |
| `/leaderboard player rsn:<name>` | Look up a player's stats (rich embed) |

### Config (Admin only)
| Command | Description |
|---|---|
| `/config wom-group group_id:<id>` | Set WOM group ID |
| `/config wom-verification code:<code>` | Set WOM verification code |
| `/config reminder-channel channel:#ch` | Set default reminder channel |
| `/config view` | View current settings |

### Clan
| Command | Description |
|---|---|
| `/clan info` | Dashboard: active SOTW, upcoming events, raffles, polls, member count |

### Polls
| Command | Description |
|---|---|
| `/vote sotw skill_1:<s> skill_2:<s> ...` | Poll for next SOTW (auto-starts winner!) |
| `/vote botw boss_1:<b> boss_2:<b> ...` | Poll for next Boss of the Week |
| `/vote generic question:<q> option_1:<o> ...` | Create a generic poll |
| `/vote results id:#` | Show poll results |
| `/vote list` | List recent polls |

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
│   ├── commands/
│   │   ├── member.js         # RSN linking
│   │   ├── event.js          # Events & reminders
│   │   ├── raffle.js         # Raffles
│   │   ├── sotw.js           # Skill of the Week
│   │   ├── leaderboard.js    # Clan leaderboards
│   │   ├── config.js         # Admin settings
│   │   └── help.js           # Help command
│   ├── services/
│   │   ├── wom.js            # Wise Old Man API client
│   │   └── reminders.js      # Reminder poller & SOTW auto-finalize
│   └── db/
│       ├── database.js       # SQLite setup & schema
│       └── init.js           # DB initialization script
├── package.json
├── .env.example
├── .gitignore
└── README.md
```

## License

MIT
