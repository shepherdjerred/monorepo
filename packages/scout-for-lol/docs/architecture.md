# Architecture Overview

Scout for LoL is a full-stack application built as a Bun monorepo with TypeScript. This document describes the high-level architecture and how components interact.

## System Architecture

```mermaid
flowchart TB
    subgraph External["External Services"]
        RIOT["Riot Games API<br/>(native Scout client)"]
        DISCORD_API["Discord API<br/>(discord.js)"]
        OPENAI["OpenAI API<br/>(GPT-4o-mini, GPT-5.1)"]
        S3["AWS S3<br/>(Match data, images)"]
        BUGSINK["Bugsink<br/>(Error tracking)"]
    end

    subgraph Backend["Backend Service"]
        direction TB
        BOT["Discord Bot"]
        TEMPORAL["Embedded Temporal Workers"]
        MATCH_POLLER["Match History Poller"]
        REPORT_GEN["Report Generator"]
        COMPETITION["Competition Manager"]
    end

    subgraph SharedPkg["Shared Packages"]
        DATA["@scout-for-lol/data<br/>(Models, Schemas, Types)"]
        REPORT["@scout-for-lol/report<br/>(JSX → SVG → PNG)"]
    end

    subgraph Storage["Data Storage"]
        DB[("PostgreSQL<br/>(Prisma ORM)")]
    end

    subgraph LOL["League Client"]
        LEAGUE_CLIENT["League of Legends"]
    end

    %% External connections
    RIOT --> MATCH_POLLER
    RIOT --> COMPETITION
    BOT <--> DISCORD_API
    REPORT_GEN --> S3
    Backend --> BUGSINK

    %% Internal backend connections
    TEMPORAL --> MATCH_POLLER
    TEMPORAL --> COMPETITION
    MATCH_POLLER --> REPORT_GEN
    REPORT_GEN --> BOT
    BOT --> DB
    COMPETITION --> DB
    COMPETITION --> BOT

    %% Package dependencies
    DATA --> Backend
    REPORT --> REPORT_GEN
    DATA --> REPORT
```

## Package Dependency Graph

```mermaid
graph BT
    DATA["@scout-for-lol/data"]
    REPORT["@scout-for-lol/report"]
    BACKEND["@scout-for-lol/backend"]
    FRONTEND["@scout-for-lol/frontend"]

    DATA --> REPORT
    DATA --> BACKEND
    DATA --> FRONTEND
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
            Cron->>S3: Save match data & images
            Cron->>Discord: Post to channel
            Cron->>DB: Update lastProcessedMatchId
        end
    end
```

### Competition Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Created: dashboard competition form

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

### Temporal Reports and Competition Analysis

ScoutQL owns reproducible report time windows. Canonical `ANALYZE`, `BUCKET BY`,
`COMPARE TO`, and `IN TIME ZONE` clauses compile to timezone-aware DuckDB
aggregations over the report lake. Report windows are capped at 365 days;
competition exploration is clamped to the competition lifespan instead.

```mermaid
flowchart LR
    MATCHES[Match and prematch JSON in S3] --> LAKE[Disposable Parquet report lake]
    LEADERBOARDS[Daily leaderboard snapshots in S3] --> RANKS[competition_rank_history]
    RANKS --> LAKE
    SCOUTQL[ScoutQL plus temporal spec] --> DUCKDB[DuckDB aggregation]
    LAKE --> DUCKDB
    DUCKDB --> SNAPSHOT[Versioned VisualizationSnapshot]
    SNAPSHOT --> WEB[Interactive ECharts web view]
    SNAPSHOT --> PNG[Deterministic SVG to PNG]
    PNG --> DISCORD[Discord and archived image]
    SNAPSHOT --> ARCHIVE[S3 report-run archive]
```

The database stores report definitions, run metadata, permissions, and the
competition analysis timezone. S3 remains authoritative for raw match facts,
leaderboard history, and archived visualization artifacts; every Parquet lake
source can be rebuilt. Official competition standings remain competition-to-date.
Selected-period analysis recomputes the criterion without mutating that cache.

### Relational Dare contracts

New Dares compile one read-only standard-SQL statement against a
closed report-lake catalog. `T1` through `T5` are ordinary participant relations
bound to the contract's frozen accounts; team-relative conditions join them to
`match_teams` by `match_id` and `team_id`. Historical preview and post-match
settlement use the same canonical SQL and immutable AST. Evidence records retain
the result, game-set projections, target dependencies, timeline coverage,
source match IDs, and query hash. Only structurally monotone counts can settle
early; rates, averages, equality, and upper bounds wait for the deadline or game
cap. Existing v1 and v2 contracts continue through their frozen evaluators.

Evaluator 3 also supplies explicit competition and activation envelopes. Race
lanes settle only after the evidence watermark passes the earliest qualifying
`game_end_at`, which admits exact-timestamp ties from separately ingested
matches. Rank and historical-improvement contracts first persist an activation
job and enter `activating`; a frozen rank or report-lake baseline starts their
eligibility window and deadline. Ranked post-match capture precedes Dare
settlement and is reused by report generation, so a required Riot failure cannot
advance either evidence or the match cursor.

## Component Responsibilities

### Backend Service

| Component           | Responsibility                                          |
| ------------------- | ------------------------------------------------------- |
| Discord Bot         | Command handling, message posting, embed creation       |
| Match Poller        | Periodic match history checking for subscribed accounts |
| Report Generator    | Orchestrates match data → PNG report pipeline           |
| Competition Manager | Leaderboard calculation, snapshot management            |
| Temporal Workers    | Run durable polling, cleanup, reports, and LLM work     |

### Data Package

| Export      | Purpose                                                 |
| ----------- | ------------------------------------------------------- |
| Zod Schemas | Validate external API responses (RawMatch, RawTimeline) |
| Model Types | Shared TypeScript types (Player, Match, Competition)    |
| Constants   | Art styles, themes, lane contexts                       |

### Report Package

| Export                    | Purpose                             |
| ------------------------- | ----------------------------------- |
| `matchToSvg()`            | Render CompletedMatch to SVG string |
| `matchToImage()`          | Render CompletedMatch to PNG bytes  |
| `arenaMatchToSvg/Image()` | Arena mode variants                 |
| `svgToPng()`              | Convert SVG string to PNG           |

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
    TYPE -->|Validation| BUGSINK_VAL[Log to Bugsink<br/>Schema drift detected]
    TYPE -->|AI Failure| SKIP[Skip AI features<br/>Continue with report]
    TYPE -->|S3 Failure| LOG[Log error<br/>Continue to Discord]
    TYPE -->|Discord Failure| BUGSINK_DISC[Log to Bugsink<br/>Check permissions]

    RETRY --> CONTINUE[Continue Processing]
    BACKOFF --> CONTINUE
    SKIP --> CONTINUE
    LOG --> CONTINUE
```

## Deployment Architecture

```mermaid
flowchart TB
    subgraph CI["CI/CD (Woodpecker)"]
        CHECK[Lint + Typecheck + Test]
        BUILD[Build and publish image]
        DEPLOY[Record release in Delivery]
    end

    subgraph Stages
        BETA[Beta Environment]
        PROD[Production Environment]
    end

    CHECK --> BUILD
    BUILD --> DEPLOY
    DEPLOY -->|ArgoCD| BETA
    BETA -->|Delivery promotion| PROD
```

## Environment Configuration

Required environment variables by component:

| Variable         | Component | Required               |
| ---------------- | --------- | ---------------------- |
| `DISCORD_TOKEN`  | Backend   | Yes                    |
| `APPLICATION_ID` | Backend   | Yes                    |
| `RIOT_API_KEY`   | Backend   | Yes                    |
| `DATABASE_URL`   | Backend   | Yes                    |
| `OPENAI_API_KEY` | Backend   | No (disables AI)       |
| `GEMINI_API_KEY` | Backend   | No (images fail)       |
| `S3_BUCKET_NAME` | Backend   | No (disables storage)  |
| `BUGSINK_DSN`    | Backend   | No (disables tracking) |

## Next Steps

- [Backend Service](./backend.md) - Detailed backend architecture
- [Database Schema](./database.md) - Data model documentation
