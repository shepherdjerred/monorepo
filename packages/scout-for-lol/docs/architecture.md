# Architecture Overview

Scout for LoL is a full-stack application built as a Bun monorepo with TypeScript. This document describes the high-level architecture and how components interact.

## System Architecture

```mermaid
flowchart TB
    subgraph External["External Services"]
        RIOT["Riot Games API<br/>(twisted library)"]
        DISCORD_API["Discord API<br/>(discord.js)"]
        OPENAI["OpenAI API<br/>(GPT-4o-mini, GPT-5.1)"]
        S3["AWS S3<br/>(Match data, images)"]
        SENTRY["Sentry<br/>(Error tracking)"]
    end

    subgraph Backend["Backend Service"]
        direction TB
        BOT["Discord Bot"]
        CRON["Cron Scheduler"]
        MATCH_POLLER["Match History Poller"]
        REPORT_GEN["Report Generator"]
        AI_REVIEW["AI Review Generator"]
        COMPETITION["Competition Manager"]
    end

    subgraph SharedPkg["Shared Packages"]
        DATA["@scout-for-lol/data<br/>(Models, Schemas, Types)"]
        REPORT["@scout-for-lol/report<br/>(JSX → SVG → PNG)"]
    end

    subgraph Desktop["Desktop App"]
        TAURI["Tauri (Rust)"]
        REACT["React Frontend"]
        LCU["LCU Client"]
    end

    subgraph Storage["Data Storage"]
        DB[("SQLite<br/>(Prisma ORM)")]
    end

    subgraph LOL["League Client"]
        LEAGUE_CLIENT["League of Legends"]
    end

    %% External connections
    RIOT --> MATCH_POLLER
    RIOT --> COMPETITION
    BOT <--> DISCORD_API
    AI_REVIEW --> OPENAI
    REPORT_GEN --> S3
    Backend --> SENTRY

    %% Internal backend connections
    CRON --> MATCH_POLLER
    CRON --> COMPETITION
    MATCH_POLLER --> REPORT_GEN
    REPORT_GEN --> AI_REVIEW
    REPORT_GEN --> BOT
    BOT --> DB
    COMPETITION --> DB
    COMPETITION --> BOT

    %% Package dependencies
    DATA --> Backend
    REPORT --> REPORT_GEN
    DATA --> REPORT
    DATA --> Desktop

    %% Desktop connections
    LCU --> LEAGUE_CLIENT
    TAURI --> LCU
    REACT --> TAURI
```

## Package Dependency Graph

```mermaid
graph BT
    DATA["@scout-for-lol/data"]
    REPORT["@scout-for-lol/report"]
    BACKEND["@scout-for-lol/backend"]
    FRONTEND["@scout-for-lol/frontend"]
    DESKTOP["@scout-for-lol/desktop"]

    DATA --> REPORT
    DATA --> BACKEND
    DATA --> FRONTEND
    DATA --> DESKTOP
    REPORT --> BACKEND
```

## Core Data Flow

### Match Report Generation

The primary flow from match detection to Discord notification:

```mermaid
sequenceDiagram
    participant Cron
    participant Riot as Riot API
    participant DB as Database
    participant Report as Report Package
    participant AI as OpenAI
    participant S3
    participant Discord

    Cron->>DB: Get subscribed accounts
    loop Every minute
        Cron->>Riot: Fetch match history
        Riot-->>Cron: Recent matches
        Cron->>DB: Check lastProcessedMatchId
        alt New match found
            Cron->>Riot: Fetch match details
            Riot-->>Cron: Match data
            Cron->>Riot: Fetch timeline
            Riot-->>Cron: Timeline data
            Cron->>Report: Generate PNG
            Report-->>Cron: Image bytes
            par AI Analysis
                Cron->>AI: Generate review
                AI-->>Cron: Analysis text
            and Art Prompt
                Cron->>AI: Generate art prompt
                AI-->>Cron: Art description
            end
            Cron->>S3: Save match data & images
            Cron->>Discord: Post to channel
            Cron->>DB: Update lastProcessedMatchId
        end
    end
```

### Competition Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Created: /competition create

    Created --> Active: startDate reached
    note right of Created
        Participants can join/leave
        Owner can edit settings
    end note

    Active --> Active: Daily leaderboard updates
    note right of Active
        START snapshots taken
        Matches tracked
        Leaderboard calculated
    end note

    Active --> Ended: endDate reached
    note right of Ended
        END snapshots taken
        Final leaderboard posted
        Winner announced
    end note

    Ended --> [*]
```

## Component Responsibilities

### Backend Service

| Component           | Responsibility                                          |
| ------------------- | ------------------------------------------------------- |
| Discord Bot         | Command handling, message posting, embed creation       |
| Match Poller        | Periodic match history checking for subscribed accounts |
| Report Generator    | Orchestrates match data → PNG report pipeline           |
| AI Review           | GPT-4o-mini match analysis, art prompt generation       |
| Competition Manager | Leaderboard calculation, snapshot management            |
| Cron Scheduler      | Schedules periodic tasks (polling, cleanup, updates)    |

### Data Package

| Export           | Purpose                                                 |
| ---------------- | ------------------------------------------------------- |
| Zod Schemas      | Validate external API responses (RawMatch, RawTimeline) |
| Model Types      | Shared TypeScript types (Player, Match, Competition)    |
| Review Utilities | Match data curation, prompt construction                |
| Constants        | Art styles, themes, lane contexts                       |

### Report Package

| Export                    | Purpose                             |
| ------------------------- | ----------------------------------- |
| `matchToSvg()`            | Render CompletedMatch to SVG string |
| `matchToImage()`          | Render CompletedMatch to PNG bytes  |
| `arenaMatchToSvg/Image()` | Arena mode variants                 |
| `svgToPng()`              | Convert SVG string to PNG           |

### Desktop Application

| Module         | Responsibility                                  |
| -------------- | ----------------------------------------------- |
| Tauri Core     | Window management, IPC, system integration      |
| LCU Client     | Connect to League Client Update API             |
| React Frontend | User interface for monitoring and configuration |

## Validation Architecture

All external data flows through Zod validation:

```mermaid
flowchart LR
    subgraph External
        API["External API<br/>(Riot, Discord)"]
    end

    subgraph Validation
        RAW["Raw* Schema<br/>(RawMatch, etc.)"]
        TRANSFORM["Transform"]
        INTERNAL["Internal Type<br/>(CompletedMatch)"]
    end

    subgraph Usage
        REPORT["Report Generation"]
        DB["Database Storage"]
        AI["AI Analysis"]
    end

    API --> RAW
    RAW -->|validate| TRANSFORM
    TRANSFORM --> INTERNAL
    INTERNAL --> REPORT
    INTERNAL --> DB
    INTERNAL --> AI
```

## Error Handling Strategy

```mermaid
flowchart TD
    ERROR[Error Occurs]
    ERROR --> TYPE{Error Type?}

    TYPE -->|API 404| RETRY[Retry Later<br/>Match still processing]
    TYPE -->|API 429| BACKOFF[Exponential Backoff<br/>Rate limit]
    TYPE -->|Validation| SENTRY_VAL[Log to Sentry<br/>Schema drift detected]
    TYPE -->|AI Failure| SKIP[Skip AI features<br/>Continue with report]
    TYPE -->|S3 Failure| LOG[Log error<br/>Continue to Discord]
    TYPE -->|Discord Failure| SENTRY_DISC[Log to Sentry<br/>Check permissions]

    RETRY --> CONTINUE[Continue Processing]
    BACKOFF --> CONTINUE
    SKIP --> CONTINUE
    LOG --> CONTINUE
```

## Deployment Architecture

```mermaid
flowchart TB
    subgraph CI["CI/CD (Dagger)"]
        CHECK[Lint + Typecheck + Test]
        BUILD[Build Docker Image]
        DEPLOY[Deploy to Stage]
    end

    subgraph Stages
        BETA[Beta Environment]
        PROD[Production Environment]
    end

    CHECK --> BUILD
    BUILD --> DEPLOY
    DEPLOY --> BETA
    BETA -->|Manual promotion| PROD
```

## Environment Configuration

Required environment variables by component:

| Variable         | Component | Required               |
| ---------------- | --------- | ---------------------- |
| `DISCORD_TOKEN`  | Backend   | Yes                    |
| `APPLICATION_ID` | Backend   | Yes                    |
| `RIOT_API_TOKEN` | Backend   | Yes                    |
| `DATABASE_URL`   | Backend   | Yes                    |
| `OPENAI_API_KEY` | Backend   | No (disables AI)       |
| `S3_BUCKET_NAME` | Backend   | No (disables storage)  |
| `SENTRY_DSN`     | Backend   | No (disables tracking) |

## Next Steps

- [Backend Service](./backend.md) - Detailed backend architecture
- [AI Review System](./ai-review-system.md) - AI pipeline details
- [Desktop Application](./desktop.md) - Tauri app architecture
- [Database Schema](./database.md) - Data model documentation
