# Backend Service Architecture

The backend service is a Discord bot that monitors League of Legends matches, generates reports, and manages competitions. It runs as a long-lived process with scheduled cron jobs.

## Service Overview

```mermaid
flowchart TB
    subgraph Entry["Entry Point"]
        INDEX["index.ts"]
    end

    subgraph Init["Initialization"]
        CONFIG["Configuration"]
        PRISMA["Prisma Client"]
        DISCORD["Discord Client"]
        SENTRY_INIT["Sentry"]
        CRON["Cron Scheduler"]
        HTTP["HTTP Server"]
    end

    subgraph Discord["Discord Layer"]
        COMMANDS["Command Handlers"]
        EVENTS["Event Handlers"]
    end

    subgraph League["League Layer"]
        API_CLIENT["Riot API Client"]
        TASKS["Scheduled Tasks"]
        COMPETITION["Competition System"]
        REVIEW["Review Generator"]
    end

    INDEX --> CONFIG
    CONFIG --> PRISMA
    PRISMA --> DISCORD
    DISCORD --> SENTRY_INIT
    SENTRY_INIT --> CRON
    CRON --> HTTP

    DISCORD --> COMMANDS
    DISCORD --> EVENTS
    CRON --> TASKS
    TASKS --> API_CLIENT
    TASKS --> REVIEW
    TASKS --> COMPETITION
```

## Discord Bot Architecture

### Command Structure

Commands are organized by category in `src/discord/commands/`:

```text
commands/
├── admin/           # Server admin commands
│   ├── account-add.ts
│   ├── account-delete.ts
│   ├── account-transfer.ts
│   ├── player-add.ts
│   ├── player-delete.ts
│   └── player-list.ts
├── competition/     # Competition management
│   ├── create.ts
│   ├── cancel.ts
│   ├── edit.ts
│   ├── invite.ts
│   ├── join.ts
│   ├── leave.ts
│   ├── list.ts
│   └── view.ts
├── subscription/    # Match notifications
│   ├── subscribe.ts
│   ├── delete.ts
│   ├── list.ts
│   └── welcome-match.ts
└── debug/           # Debug utilities
    ├── force-snapshot.ts
    └── force-leaderboard.ts
```

### Command Registration Flow

```mermaid
sequenceDiagram
    participant Bot as Discord Bot
    participant Discord as Discord API
    participant Handler as Command Handler
    participant DB as Database

    Bot->>Discord: Register slash commands
    Discord-->>Bot: Commands registered

    Discord->>Bot: Interaction received
    Bot->>Handler: Route to handler
    Handler->>DB: Query/mutate data
    DB-->>Handler: Result
    Handler->>Discord: Reply to interaction
```

### Command Implementation Pattern

Each command exports:

- `data`: SlashCommandBuilder definition
- `execute`: Async handler function

```typescript
// Example: src/discord/commands/subscription/subscribe.ts
export const data = new SlashCommandBuilder()
  .setName("subscribe")
  .setDescription("Subscribe to match notifications")
  .addUserOption(/* ... */);

export async function execute(interaction: ChatInputCommandInteraction) {
  // Validate input with Zod
  // Query/mutate database
  // Reply to interaction
}
```

## Cron Job System

### Schedule Overview

```mermaid
gantt
    title Cron Job Schedule (UTC)
    dateFormat HH:mm
    axisFormat %H:%M

    section Every Minute
    Match Polling        :active, 00:00, 1m

    section Every 15 Minutes
    Competition Lifecycle :00:00, 15m

    section Hourly
    Data Validation      :00:00, 1h

    section Daily
    Leaderboard Update   :00:00, 1m
    Player Pruning       :03:00, 1m
    Guild Cleanup        :04:00, 1m
```

### Task Definitions

| Task                        | Schedule         | Description                       |
| --------------------------- | ---------------- | --------------------------------- |
| `checkPostMatch`            | `0 * * * * *`    | Poll match history for new games  |
| `runLifecycleCheck`         | `0 */15 * * * *` | Check competition start/end dates |
| `runDataValidation`         | `0 0 * * * *`    | Clean orphaned data               |
| `runDailyLeaderboardUpdate` | `0 0 0 * * *`    | Post daily leaderboards           |
| `runPlayerPruning`          | `0 0 3 * * *`    | Remove inactive players           |
| `runAbandonedGuildCleanup`  | `0 0 4 * * *`    | Identify inactive servers         |

### Match Polling Flow

```mermaid
flowchart TD
    START[Cron Trigger]
    START --> GET_ACCOUNTS[Get subscribed accounts]
    GET_ACCOUNTS --> LOOP{For each account}

    LOOP --> FETCH_HISTORY[Fetch match history]
    FETCH_HISTORY --> CHECK_NEW{New matches?}

    CHECK_NEW -->|No| NEXT[Next account]
    CHECK_NEW -->|Yes| PROCESS[Process match]

    PROCESS --> FETCH_MATCH[Fetch match details]
    FETCH_MATCH --> FETCH_TIMELINE[Fetch timeline]
    FETCH_TIMELINE --> VALIDATE[Validate with Zod]
    VALIDATE --> GENERATE[Generate report]
    GENERATE --> AI[AI analysis]
    AI --> SAVE[Save to S3]
    SAVE --> POST[Post to Discord]
    POST --> UPDATE_DB[Update lastProcessedMatchId]
    UPDATE_DB --> NEXT

    NEXT --> LOOP
    LOOP -->|Done| END[End]
```

## Riot Games API Integration

### API Client Setup

```mermaid
flowchart LR
    CONFIG["RIOT_API_TOKEN"]
    CONFIG --> LOL_API["LolApi Client"]
    CONFIG --> RIOT_API["RiotApi Client"]

    LOL_API --> MATCH["MatchV5"]
    LOL_API --> SUMMONER["SummonerV4"]
    LOL_API --> RANKED["RankedV4"]
    RIOT_API --> ACCOUNT["AccountV1"]
```

### Rate Limiting

The `twisted` library handles rate limiting automatically:

- **Retry attempts**: 3
- **Concurrency**: 1 (sequential requests)
- **Backoff**: Built-in exponential backoff

### Data Validation

All API responses are validated with Zod schemas:

```mermaid
flowchart LR
    API["Riot API Response"]
    API --> PARSE["Zod safeParse"]
    PARSE --> SUCCESS{Valid?}
    SUCCESS -->|Yes| USE["Use typed data"]
    SUCCESS -->|No| ERROR["Log to Sentry"]
```

Schemas defined in `@scout-for-lol/data`:

- `RawMatchSchema` - Match data
- `RawTimelineSchema` - Match timeline
- `RawSummonerLeagueSchema` - Rank data

## Competition System

### Competition Criteria

| Criteria             | Description               |
| -------------------- | ------------------------- |
| `MOST_GAMES_PLAYED`  | Total games in period     |
| `HIGHEST_RANK`       | Current rank (tier + LP)  |
| `MOST_RANK_CLIMB`    | LP gained from start      |
| `MOST_WINS_PLAYER`   | Total wins                |
| `MOST_WINS_CHAMPION` | Wins on specific champion |
| `HIGHEST_WIN_RATE`   | Win percentage            |

### Snapshot System

```mermaid
flowchart TB
    subgraph Start["Competition Start"]
        START_TRIGGER[startDate reached]
        START_TRIGGER --> START_SNAP[Create START snapshots]
        START_SNAP --> FETCH_RANKS[Fetch current ranks]
        FETCH_RANKS --> SAVE_START[Save to CompetitionSnapshot]
    end

    subgraph During["Competition Active"]
        DAILY[Daily update]
        DAILY --> CALC[Calculate leaderboard]
        CALC --> POST_LB[Post to channel]
    end

    subgraph End["Competition End"]
        END_TRIGGER[endDate reached]
        END_TRIGGER --> END_SNAP[Create END snapshots]
        END_SNAP --> FETCH_END[Fetch final ranks]
        FETCH_END --> SAVE_END[Save to CompetitionSnapshot]
        SAVE_END --> FINAL[Calculate final standings]
        FINAL --> ANNOUNCE[Announce winner]
    end

    Start --> During
    During --> End
```

### Leaderboard Processors

Each criteria has a dedicated processor in `src/league/competition/processors/`:

```typescript
// Example: most-rank-climb.ts
export async function processLeaderboard(
  competition: Competition,
  participants: Participant[],
  startSnapshots: Snapshot[],
  endSnapshots: Snapshot[],
): Promise<LeaderboardEntry[]> {
  // Calculate LP difference between snapshots
  // Sort by climb amount
  // Return ranked entries
}
```

## HTTP Endpoints

The backend exposes two HTTP endpoints:

| Endpoint       | Purpose                       |
| -------------- | ----------------------------- |
| `GET /ping`    | Health check (returns "pong") |
| `GET /metrics` | Prometheus metrics            |

### Metrics Exported

- `discord_connection_status` - Bot connection state
- `discord_guild_count` - Number of servers
- `discord_user_count` - Total users across servers
- `discord_latency_ms` - API latency
- Process metrics (memory, CPU)

## Error Handling

### Strategy by Error Type

| Error              | Handling                               |
| ------------------ | -------------------------------------- |
| API 404            | Retry later (match still processing)   |
| API 429            | Automatic backoff via twisted          |
| Validation failure | Log to Sentry, skip processing         |
| AI failure         | Continue without AI features           |
| S3 failure         | Log and continue to Discord            |
| Discord failure    | Log to Sentry, track permission errors |

### Permission Error Tracking

```mermaid
flowchart TD
    POST[Post to Discord]
    POST --> ERROR{Permission error?}

    ERROR -->|No| SUCCESS[Success]
    SUCCESS --> RESET[Reset error counter]

    ERROR -->|Yes| INCREMENT[Increment counter]
    INCREMENT --> CHECK{Counter > threshold?}
    CHECK -->|No| CONTINUE[Continue]
    CHECK -->|Yes| FLAG[Flag guild as abandoned]
```

## File Structure

```text
packages/backend/
├── prisma/
│   └── schema.prisma        # Database schema
├── src/
│   ├── index.ts             # Entry point
│   ├── configuration.ts     # Environment config
│   ├── discord/
│   │   ├── client.ts        # Discord.js setup
│   │   ├── commands/        # Slash commands
│   │   └── events/          # Event handlers
│   ├── league/
│   │   ├── api/             # Riot API client
│   │   ├── competition/     # Competition system
│   │   ├── review/          # AI review generation
│   │   ├── tasks/           # Scheduled tasks
│   │   └── cron.ts          # Cron scheduler
│   ├── metrics/             # Prometheus metrics
│   └── sentry/              # Error tracking
└── package.json
```

## Next Steps

- [AI Review System](./ai-review-system.md) - How AI analysis works
- [Database Schema](./database.md) - Data model details
