# Birmel Discord Bot - Comprehensive Implementation Plan

## Executive Summary

**Birmel** is an AI-powered Discord "Server Owner" bot that manages Discord servers through natural language—both text and voice. Users can type "hey birmel, rename this server" or speak commands in voice chat. The bot uses Mastra + Claude for AI reasoning, OpenAI for speech-to-text/text-to-speech, and Discord.js for all Discord operations including music playback.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Tech Stack](#tech-stack)
3. [Project Structure](#project-structure)
4. [Configuration & Environment](#configuration--environment)
5. [Discord Client Setup](#discord-client-setup)
6. [Mastra Agent Architecture](#mastra-agent-architecture)
7. [Tool Definitions](#tool-definitions)
8. [Music System](#music-system)
9. [Voice Interaction (STT/TTS)](#voice-interaction-stttts)
10. [Database Schema](#database-schema)
11. [Daily Posts Scheduler](#daily-posts-scheduler)
12. [Error Handling & Logging](#error-handling--logging)
13. [Security Considerations](#security-considerations)
14. [Testing Strategy](#testing-strategy)
15. [CI/CD Integration](#cicd-integration)
16. [Implementation Phases](#implementation-phases)
17. [Files to Create/Modify](#files-to-createmodify)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BIRMEL BOT                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐                │
│  │   Discord    │     │    Voice     │     │  Scheduler   │                │
│  │   Gateway    │     │   Channel    │     │  (Daily)     │                │
│  └──────┬───────┘     └──────┬───────┘     └──────┬───────┘                │
│         │                    │                    │                         │
│         ▼                    ▼                    ▼                         │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐                │
│  │   Message    │     │   Voice      │     │   Cron       │                │
│  │   Handler    │     │   Receiver   │     │   Trigger    │                │
│  └──────┬───────┘     └──────┬───────┘     └──────┬───────┘                │
│         │                    │                    │                         │
│         │             ┌──────▼───────┐            │                         │
│         │             │   OpenAI     │            │                         │
│         │             │   Whisper    │            │                         │
│         │             │   (STT)      │            │                         │
│         │             └──────┬───────┘            │                         │
│         │                    │                    │                         │
│         └────────────────────┼────────────────────┘                         │
│                              ▼                                              │
│                    ┌─────────────────┐                                      │
│                    │   MASTRA AGENT  │                                      │
│                    │   (Claude LLM)  │                                      │
│                    └────────┬────────┘                                      │
│                             │                                               │
│         ┌───────────────────┼───────────────────┐                          │
│         ▼                   ▼                   ▼                          │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐                   │
│  │   Discord    │   │    Music     │   │   External   │                   │
│  │    Tools     │   │    Tools     │   │    Tools     │                   │
│  │  (80+ ops)   │   │  (playback)  │   │ (web/news)   │                   │
│  └──────┬───────┘   └──────┬───────┘   └──────────────┘                   │
│         │                  │                                               │
│         ▼                  ▼                                               │
│  ┌──────────────┐   ┌──────────────┐                                      │
│  │  Discord.js  │   │discord-player│                                      │
│  │    Client    │   │   + Voice    │                                      │
│  └──────────────┘   └──────┬───────┘                                      │
│                            │                                               │
│                     ┌──────▼───────┐                                       │
│                     │   OpenAI     │                                       │
│                     │    TTS       │                                       │
│                     │  (Response)  │                                       │
│                     └──────────────┘                                       │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                        SQLite Database                                │  │
│  │  [conversations] [server_events] [user_prefs] [music_history]        │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Category | Technology | Version | Purpose |
|----------|------------|---------|---------|
| **Runtime** | Bun | latest | Fast JS runtime, native SQLite |
| **Language** | TypeScript | ^5.6.0 | Type safety |
| **Discord** | discord.js | ^14.16.0 | Discord API client |
| **Voice** | @discordjs/voice | ^0.17.0 | Voice connections |
| **Music** | discord-player | ^6.7.0 | Music playback framework |
| **Music Extractors** | @discord-player/extractor | ^4.5.0 | YouTube/Spotify extraction |
| **AI Framework** | @mastra/core | ^0.9.0 | Agent orchestration |
| **LLM** | Claude (Anthropic) | claude-sonnet-4-20250514 | Primary reasoning |
| **STT** | OpenAI Whisper | whisper-1 | Speech-to-text |
| **TTS** | OpenAI TTS | tts-1 | Text-to-speech |
| **Database** | bun:sqlite | native | Conversation memory |
| **Validation** | Zod | ^3.23.0 | Schema validation |
| **Linting** | ESLint | ^9.0.0 | Code quality |
| **CI** | Dagger | ^0.19.0 | CI/CD pipelines |
| **System** | ffmpeg | - | Audio encoding |

---

## Project Structure

```
packages/birmel/
├── package.json
├── tsconfig.json
├── eslint.config.ts
├── bunfig.toml
├── .env.example
├── Dockerfile
│
├── src/
│   ├── index.ts                           # Application entry point
│   │
│   ├── config/
│   │   ├── index.ts                       # Config loader & validator
│   │   ├── schema.ts                      # Zod schemas for all config
│   │   └── constants.ts                   # Static constants
│   │
│   ├── discord/
│   │   ├── index.ts                       # Discord module exports
│   │   ├── client.ts                      # Discord.js client singleton
│   │   ├── intents.ts                     # Gateway intents configuration
│   │   ├── permissions.ts                 # Permission checking utilities
│   │   └── events/
│   │       ├── index.ts                   # Event handler registration
│   │       ├── ready.ts                   # Bot ready event
│   │       ├── message-create.ts          # Text message handler
│   │       ├── interaction-create.ts      # Slash command handler (future)
│   │       ├── voice-state-update.ts      # Voice channel join/leave
│   │       ├── guild-create.ts            # Bot added to server
│   │       └── guild-delete.ts            # Bot removed from server
│   │
│   ├── mastra/
│   │   ├── index.ts                       # Mastra instance & config
│   │   ├── agents/
│   │   │   ├── index.ts
│   │   │   ├── birmel-agent.ts            # Main conversational agent
│   │   │   └── system-prompt.ts           # Agent personality & instructions
│   │   └── tools/
│   │       ├── index.ts                   # All tools aggregated
│   │       ├── types.ts                   # Shared tool types
│   │       ├── discord/
│   │       │   ├── index.ts
│   │       │   ├── guild.ts               # Server management tools
│   │       │   ├── channels.ts            # Channel management tools
│   │       │   ├── members.ts             # Member management tools
│   │       │   ├── roles.ts               # Role management tools
│   │       │   ├── messages.ts            # Message tools
│   │       │   ├── moderation.ts          # Ban/kick/timeout tools
│   │       │   ├── emojis.ts              # Emoji/sticker tools
│   │       │   ├── events.ts              # Scheduled events tools
│   │       │   ├── automod.ts             # Auto-moderation tools
│   │       │   ├── webhooks.ts            # Webhook tools
│   │       │   ├── invites.ts             # Invite tools
│   │       │   └── voice.ts               # Voice channel tools
│   │       ├── music/
│   │       │   ├── index.ts
│   │       │   ├── playback.ts            # Play, pause, skip, stop
│   │       │   ├── queue.ts               # Queue management
│   │       │   └── control.ts             # Volume, loop, seek
│   │       └── external/
│   │           ├── index.ts
│   │           ├── web.ts                 # URL fetching
│   │           ├── news.ts                # News API
│   │           └── lol.ts                 # League of Legends API
│   │
│   ├── music/
│   │   ├── index.ts                       # Music module exports
│   │   ├── player.ts                      # discord-player setup
│   │   ├── extractors.ts                  # YouTube/Spotify extractors
│   │   └── events.ts                      # Player event handlers
│   │
│   ├── voice/
│   │   ├── index.ts                       # Voice module exports
│   │   ├── receiver.ts                    # Audio reception from users
│   │   ├── speech-to-text.ts              # OpenAI Whisper integration
│   │   ├── text-to-speech.ts              # OpenAI TTS integration
│   │   ├── audio-buffer.ts                # Per-user audio buffering
│   │   ├── voice-activity.ts              # Voice activity detection
│   │   └── command-handler.ts             # "Hey Birmel" trigger detection
│   │
│   ├── database/
│   │   ├── index.ts                       # Database module exports
│   │   ├── client.ts                      # bun:sqlite connection
│   │   ├── migrations/
│   │   │   ├── index.ts                   # Migration runner
│   │   │   ├── 001-initial.ts             # Initial schema
│   │   │   └── 002-music-history.ts       # Music history table
│   │   └── repositories/
│   │       ├── index.ts
│   │       ├── conversations.ts           # Chat history CRUD
│   │       ├── server-events.ts           # Server activity CRUD
│   │       ├── user-preferences.ts        # User settings CRUD
│   │       └── music-history.ts           # Music play history
│   │
│   ├── scheduler/
│   │   ├── index.ts                       # Scheduler setup
│   │   ├── daily-posts.ts                 # Daily update job
│   │   └── jobs/
│   │       ├── server-summary.ts          # Generate server summary
│   │       └── announcements.ts           # Post announcements
│   │
│   └── utils/
│       ├── index.ts
│       ├── logger.ts                      # Structured logging
│       ├── rate-limiter.ts                # API rate limiting
│       ├── retry.ts                       # Retry with backoff
│       └── audio.ts                       # Audio format utilities
│
└── tests/
    ├── setup.ts                           # Test setup
    ├── config/
    │   └── schema.test.ts
    ├── mastra/
    │   ├── agents/
    │   │   └── birmel-agent.test.ts
    │   └── tools/
    │       ├── discord.test.ts
    │       └── music.test.ts
    ├── voice/
    │   ├── speech-to-text.test.ts
    │   └── text-to-speech.test.ts
    └── database/
        └── repositories.test.ts
```

---

## Configuration & Environment

### Environment Variables

```bash
# ═══════════════════════════════════════════════════════════════════════════
# REQUIRED
# ═══════════════════════════════════════════════════════════════════════════

# Discord Bot Credentials
DISCORD_TOKEN=                          # Bot token from Discord Developer Portal
DISCORD_CLIENT_ID=                      # Application ID

# AI Services
ANTHROPIC_API_KEY=                      # Claude API key for Mastra agent
OPENAI_API_KEY=                         # OpenAI API key for Whisper STT + TTS

# ═══════════════════════════════════════════════════════════════════════════
# OPTIONAL - Database
# ═══════════════════════════════════════════════════════════════════════════

DATABASE_PATH=./data/birmel.db          # SQLite database location

# ═══════════════════════════════════════════════════════════════════════════
# OPTIONAL - Daily Posts
# ═══════════════════════════════════════════════════════════════════════════

DAILY_POSTS_ENABLED=true                # Enable/disable daily posts
DAILY_POST_TIME=09:00                   # Time in HH:MM format (server timezone)
DAILY_POST_TIMEZONE=America/Los_Angeles # Timezone for scheduling

# ═══════════════════════════════════════════════════════════════════════════
# OPTIONAL - Voice/TTS
# ═══════════════════════════════════════════════════════════════════════════

TTS_VOICE=nova                          # OpenAI voice: alloy, echo, fable, onyx, nova, shimmer
TTS_SPEED=1.0                           # Speech speed: 0.25 to 4.0
VOICE_ENABLED=true                      # Enable voice command listening

# ═══════════════════════════════════════════════════════════════════════════
# OPTIONAL - External APIs
# ═══════════════════════════════════════════════════════════════════════════

NEWS_API_KEY=                           # NewsAPI.org API key
RIOT_API_KEY=                           # Riot Games API key for LoL updates

# ═══════════════════════════════════════════════════════════════════════════
# OPTIONAL - Observability
# ═══════════════════════════════════════════════════════════════════════════

LOG_LEVEL=info                          # debug, info, warn, error
SENTRY_DSN=                             # Sentry error tracking
```

### Configuration Schema (Zod)

```typescript
// src/config/schema.ts
import { z } from "zod";

export const DiscordConfigSchema = z.object({
  token: z.string().min(1, "DISCORD_TOKEN is required"),
  clientId: z.string().min(1, "DISCORD_CLIENT_ID is required"),
});

export const AnthropicConfigSchema = z.object({
  apiKey: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  model: z.string().default("claude-sonnet-4-20250514"),
  maxTokens: z.number().default(4096),
});

export const OpenAIConfigSchema = z.object({
  apiKey: z.string().min(1, "OPENAI_API_KEY is required"),
  whisperModel: z.string().default("whisper-1"),
  ttsModel: z.string().default("tts-1"),
  ttsVoice: z.enum(["alloy", "echo", "fable", "onyx", "nova", "shimmer"]).default("nova"),
  ttsSpeed: z.number().min(0.25).max(4.0).default(1.0),
});

export const DatabaseConfigSchema = z.object({
  path: z.string().default("./data/birmel.db"),
});

export const DailyPostsConfigSchema = z.object({
  enabled: z.boolean().default(true),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Time must be HH:MM format").default("09:00"),
  timezone: z.string().default("America/Los_Angeles"),
});

export const VoiceConfigSchema = z.object({
  enabled: z.boolean().default(true),
  silenceThresholdMs: z.number().default(1500),    // Silence before processing
  maxRecordingMs: z.number().default(30000),       // Max recording length
});

export const ExternalApisSchema = z.object({
  newsApiKey: z.string().optional(),
  riotApiKey: z.string().optional(),
});

export const LoggingConfigSchema = z.object({
  level: z.enum(["debug", "info", "warn", "error"]).default("info"),
  sentryDsn: z.string().optional(),
});

export const ConfigSchema = z.object({
  discord: DiscordConfigSchema,
  anthropic: AnthropicConfigSchema,
  openai: OpenAIConfigSchema,
  database: DatabaseConfigSchema,
  dailyPosts: DailyPostsConfigSchema,
  voice: VoiceConfigSchema,
  externalApis: ExternalApisSchema,
  logging: LoggingConfigSchema,
});

export type Config = z.infer<typeof ConfigSchema>;
```

---

## Discord Client Setup

### Gateway Intents

```typescript
// src/discord/intents.ts
import { GatewayIntentBits, Partials } from "discord.js";

export const GATEWAY_INTENTS = [
  // Core functionality
  GatewayIntentBits.Guilds,                    // Guild events, channel info
  GatewayIntentBits.GuildMessages,             // Message events in guilds
  GatewayIntentBits.MessageContent,            // Read message content (PRIVILEGED)

  // Member management
  GatewayIntentBits.GuildMembers,              // Member events (PRIVILEGED)
  GatewayIntentBits.GuildModeration,           // Ban events

  // Voice functionality
  GatewayIntentBits.GuildVoiceStates,          // Voice state changes

  // Additional features
  GatewayIntentBits.GuildPresences,            // User presence (optional, PRIVILEGED)
  GatewayIntentBits.GuildMessageReactions,     // Reaction events
  GatewayIntentBits.GuildScheduledEvents,      // Scheduled events
  GatewayIntentBits.GuildIntegrations,         // Integration events
  GatewayIntentBits.GuildWebhooks,             // Webhook events
  GatewayIntentBits.GuildInvites,              // Invite events
  GatewayIntentBits.DirectMessages,            // DM functionality
];

export const PARTIALS = [
  Partials.Message,
  Partials.Channel,
  Partials.Reaction,
  Partials.User,
  Partials.GuildMember,
];
```

### Client Initialization

```typescript
// src/discord/client.ts
import { Client } from "discord.js";
import { GATEWAY_INTENTS, PARTIALS } from "./intents";

let client: Client | null = null;

export function getDiscordClient(): Client {
  if (!client) {
    client = new Client({
      intents: GATEWAY_INTENTS,
      partials: PARTIALS,
      failIfNotExists: false,
      rest: {
        timeout: 30_000,
        retries: 3,
      },
    });
  }
  return client;
}

export function destroyDiscordClient(): void {
  if (client) {
    client.destroy();
    client = null;
  }
}
```

### Required Bot Permissions

```
Administrator (for full functionality)

OR granular permissions:
├── General
│   ├── View Channels
│   ├── Manage Channels
│   ├── Manage Roles
│   ├── Manage Emojis and Stickers
│   ├── View Audit Log
│   ├── Manage Webhooks
│   ├── Manage Server
│   └── Manage Events
├── Text
│   ├── Send Messages
│   ├── Send Messages in Threads
│   ├── Create Public Threads
│   ├── Create Private Threads
│   ├── Embed Links
│   ├── Attach Files
│   ├── Add Reactions
│   ├── Use External Emojis
│   ├── Manage Messages
│   ├── Manage Threads
│   └── Read Message History
├── Voice
│   ├── Connect
│   ├── Speak
│   ├── Mute Members
│   ├── Deafen Members
│   ├── Move Members
│   └── Use Voice Activity
└── Moderation
    ├── Kick Members
    ├── Ban Members
    └── Moderate Members (timeout)
```

---

## Mastra Agent Architecture

### Agent Definition

```typescript
// src/mastra/agents/birmel-agent.ts
import { Agent } from "@mastra/core/agent";
import { anthropic } from "@ai-sdk/anthropic";
import { allTools } from "../tools";
import { SYSTEM_PROMPT } from "./system-prompt";
import { config } from "../../config";

export const birmelAgent = new Agent({
  name: "Birmel",
  instructions: SYSTEM_PROMPT,
  model: anthropic(config.anthropic.model),
  tools: allTools,
});
```

### System Prompt

```typescript
// src/mastra/agents/system-prompt.ts
export const SYSTEM_PROMPT = `You are Birmel, an AI-powered Discord server assistant. You help manage Discord servers through natural conversation.

## Personality
- Friendly, helpful, and professional
- Concise but thorough in explanations
- Use casual language but maintain respect
- Add light humor when appropriate
- Never be condescending or dismissive

## Capabilities
You can perform ANY server management action except deleting the server. This includes:
- Server settings (name, icon, banner, etc.)
- Channel management (create, edit, delete, reorder)
- Role management (create, edit, assign, remove)
- Member management (kick, ban, timeout, nickname)
- Message management (send, delete, pin)
- Emoji and sticker management
- Scheduled events
- Auto-moderation rules
- Webhooks and invites
- Voice channel operations
- Music playback (YouTube, etc.)

## Behavior Guidelines

### Permission Verification
Before executing any administrative action:
1. Check if the requesting user has the required Discord permissions
2. If they don't have permission, politely explain why you can't help
3. Never bypass permission checks

### Destructive Actions
For destructive actions (kick, ban, delete channel, bulk delete messages):
1. Confirm the action with the user before executing
2. Explain what will happen
3. Only proceed after explicit confirmation

### Context Awareness
- You receive the user's Discord ID, guild ID, and permissions with each request
- Use this context to personalize responses
- Remember conversation history for continuity

### Music Commands
When users ask to play music:
- Join their voice channel if not already in one
- Search for the song if given a name (not URL)
- Provide feedback on what's playing

### Voice Commands
When receiving voice commands (transcribed speech):
- Keep responses concise (they'll be spoken back)
- Confirm actions verbally
- If unclear, ask for clarification

## Response Format
- Use Discord markdown when appropriate
- Keep responses under 2000 characters (Discord limit)
- Use embeds for structured information when helpful
- For voice responses, keep under 200 words for TTS

## Error Handling
If an action fails:
- Explain what went wrong in user-friendly terms
- Suggest alternatives if available
- Never expose internal error details or stack traces
`;
```

### Mastra Instance

```typescript
// src/mastra/index.ts
import { Mastra } from "@mastra/core";
import { birmelAgent } from "./agents/birmel-agent";

export const mastra = new Mastra({
  agents: { birmel: birmelAgent },
});

export { birmelAgent };
```

---

## Tool Definitions

### Tool Schema Pattern

Each tool follows this pattern:

```typescript
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const exampleTool = createTool({
  id: "example-tool",
  description: "What this tool does",
  inputSchema: z.object({
    // Input parameters with descriptions
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z.unknown().optional(),
  }),
  execute: async ({ context }) => {
    // Implementation
  },
});
```

### Discord Tools Summary (by file)

#### `src/mastra/tools/discord/guild.ts`
| Tool ID | Description |
|---------|-------------|
| `get-guild-info` | Get server information |
| `modify-guild` | Change server settings (name, icon, etc.) |
| `set-guild-icon` | Upload new server icon |
| `set-guild-banner` | Upload new server banner |
| `get-audit-logs` | Retrieve audit log entries |
| `get-guild-prune-count` | Count pruneable members |
| `prune-members` | Remove inactive members |

#### `src/mastra/tools/discord/channels.ts`
| Tool ID | Description |
|---------|-------------|
| `list-channels` | List all channels |
| `get-channel` | Get channel details |
| `create-channel` | Create new channel |
| `modify-channel` | Edit channel settings |
| `delete-channel` | Delete a channel |
| `reorder-channels` | Change channel positions |
| `set-channel-permissions` | Modify permission overwrites |

#### `src/mastra/tools/discord/members.ts`
| Tool ID | Description |
|---------|-------------|
| `get-member` | Get member info |
| `list-members` | List server members |
| `search-members` | Search by username |
| `modify-member` | Edit member (nickname, roles) |
| `add-role-to-member` | Assign role |
| `remove-role-from-member` | Remove role |

#### `src/mastra/tools/discord/moderation.ts`
| Tool ID | Description |
|---------|-------------|
| `kick-member` | Kick from server |
| `ban-member` | Ban from server |
| `unban-member` | Remove ban |
| `list-bans` | List all bans |
| `timeout-member` | Apply timeout |
| `remove-timeout` | Remove timeout |

#### `src/mastra/tools/discord/messages.ts`
| Tool ID | Description |
|---------|-------------|
| `send-message` | Send message to channel |
| `edit-message` | Edit bot's message |
| `delete-message` | Delete a message |
| `bulk-delete-messages` | Delete multiple messages |
| `pin-message` | Pin a message |
| `unpin-message` | Unpin a message |
| `add-reaction` | Add reaction |
| `remove-reaction` | Remove reaction |

#### `src/mastra/tools/discord/roles.ts`
| Tool ID | Description |
|---------|-------------|
| `list-roles` | List all roles |
| `get-role` | Get role details |
| `create-role` | Create new role |
| `modify-role` | Edit role settings |
| `delete-role` | Delete a role |
| `reorder-roles` | Change role positions |

#### `src/mastra/tools/discord/emojis.ts`
| Tool ID | Description |
|---------|-------------|
| `list-emojis` | List server emojis |
| `create-emoji` | Upload new emoji |
| `modify-emoji` | Rename emoji |
| `delete-emoji` | Delete emoji |
| `list-stickers` | List server stickers |
| `create-sticker` | Upload new sticker |
| `delete-sticker` | Delete sticker |

#### `src/mastra/tools/discord/events.ts`
| Tool ID | Description |
|---------|-------------|
| `list-scheduled-events` | List all events |
| `create-scheduled-event` | Create new event |
| `modify-scheduled-event` | Edit event |
| `delete-scheduled-event` | Cancel event |
| `get-event-users` | List interested users |

#### `src/mastra/tools/discord/automod.ts`
| Tool ID | Description |
|---------|-------------|
| `list-automod-rules` | List rules |
| `get-automod-rule` | Get rule details |
| `create-automod-rule` | Create rule |
| `modify-automod-rule` | Edit rule |
| `delete-automod-rule` | Delete rule |

#### `src/mastra/tools/discord/webhooks.ts`
| Tool ID | Description |
|---------|-------------|
| `list-webhooks` | List webhooks |
| `create-webhook` | Create webhook |
| `modify-webhook` | Edit webhook |
| `delete-webhook` | Delete webhook |
| `execute-webhook` | Send via webhook |

#### `src/mastra/tools/discord/invites.ts`
| Tool ID | Description |
|---------|-------------|
| `list-invites` | List server invites |
| `create-invite` | Create new invite |
| `delete-invite` | Revoke invite |
| `get-vanity-url` | Get vanity URL |

#### `src/mastra/tools/discord/voice.ts`
| Tool ID | Description |
|---------|-------------|
| `join-voice-channel` | Join voice channel |
| `leave-voice-channel` | Leave voice channel |
| `move-member-to-channel` | Move member |
| `disconnect-member` | Disconnect from voice |
| `server-mute-member` | Mute in voice |
| `server-deafen-member` | Deafen in voice |

### Music Tools (`src/mastra/tools/music/`)

| Tool ID | Description |
|---------|-------------|
| `play-music` | Play YouTube URL or search |
| `pause-music` | Pause playback |
| `resume-music` | Resume playback |
| `skip-track` | Skip current track |
| `stop-music` | Stop and clear queue |
| `get-queue` | Show current queue |
| `add-to-queue` | Add track to queue |
| `remove-from-queue` | Remove from queue |
| `shuffle-queue` | Shuffle queue |
| `set-volume` | Set volume (0-100) |
| `now-playing` | Current track info |
| `loop-mode` | Set loop (off/track/queue) |
| `seek` | Seek to position |

### External Tools (`src/mastra/tools/external/`)

| Tool ID | Description |
|---------|-------------|
| `fetch-url` | Fetch and summarize web page |
| `get-news` | Get news headlines |
| `get-lol-updates` | League of Legends news/patches |

---

## Music System

### Player Setup

```typescript
// src/music/player.ts
import { Player } from "discord-player";
import { YoutubeiExtractor } from "@discord-player/extractor";
import { getDiscordClient } from "../discord/client";

let player: Player | null = null;

export async function getMusicPlayer(): Promise<Player> {
  if (!player) {
    const client = getDiscordClient();
    player = new Player(client, {
      ytdlOptions: {
        quality: "highestaudio",
        highWaterMark: 1 << 25,
      },
    });

    // Register extractors
    await player.extractors.register(YoutubeiExtractor, {});

    // Set up event handlers
    setupPlayerEvents(player);
  }
  return player;
}

function setupPlayerEvents(player: Player): void {
  player.events.on("playerStart", (queue, track) => {
    queue.metadata?.channel?.send(`🎵 Now playing: **${track.title}**`);
  });

  player.events.on("audioTrackAdd", (queue, track) => {
    queue.metadata?.channel?.send(`✅ Added to queue: **${track.title}**`);
  });

  player.events.on("emptyQueue", (queue) => {
    queue.metadata?.channel?.send("Queue finished! Add more songs to keep the party going.");
  });

  player.events.on("error", (queue, error) => {
    console.error(`Player error in ${queue.guild.name}:`, error);
  });
}
```

---

## Voice Interaction (STT/TTS)

### Voice Activity Detection Flow

```
┌────────────────────────────────────────────────────────────────────┐
│                    Voice Command Processing                         │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  User speaks in voice channel                                       │
│           │                                                         │
│           ▼                                                         │
│  ┌─────────────────┐                                               │
│  │ VoiceReceiver   │  Opus audio stream per user                   │
│  │ (discord.js)    │                                               │
│  └────────┬────────┘                                               │
│           │                                                         │
│           ▼                                                         │
│  ┌─────────────────┐                                               │
│  │ AudioBuffer     │  Buffer audio until silence detected          │
│  │ (per user)      │  Silence threshold: 1.5s                      │
│  └────────┬────────┘                                               │
│           │                                                         │
│           ▼                                                         │
│  ┌─────────────────┐                                               │
│  │ Convert to WAV  │  Opus → PCM → WAV                             │
│  │ (ffmpeg)        │                                               │
│  └────────┬────────┘                                               │
│           │                                                         │
│           ▼                                                         │
│  ┌─────────────────┐                                               │
│  │ OpenAI Whisper  │  POST /v1/audio/transcriptions               │
│  │ API             │  model: whisper-1                             │
│  └────────┬────────┘                                               │
│           │                                                         │
│           ▼                                                         │
│  ┌─────────────────┐                                               │
│  │ Trigger Check   │  Does text contain "birmel"?                  │
│  │                 │  Patterns: "hey birmel", "birmel,", etc.      │
│  └────────┬────────┘                                               │
│           │ Yes                                                     │
│           ▼                                                         │
│  ┌─────────────────┐                                               │
│  │ Mastra Agent    │  Process as command                           │
│  │ (Claude)        │                                               │
│  └────────┬────────┘                                               │
│           │                                                         │
│           ▼                                                         │
│  ┌─────────────────┐                                               │
│  │ OpenAI TTS      │  POST /v1/audio/speech                       │
│  │ API             │  model: tts-1, voice: nova                    │
│  └────────┬────────┘                                               │
│           │                                                         │
│           ▼                                                         │
│  ┌─────────────────┐                                               │
│  │ Play Audio      │  Stream to voice channel                      │
│  │ (discord.js)    │                                               │
│  └─────────────────┘                                               │
│                                                                     │
└────────────────────────────────────────────────────────────────────┘
```

### Speech-to-Text

```typescript
// src/voice/speech-to-text.ts
import OpenAI from "openai";
import { config } from "../config";

const openai = new OpenAI({ apiKey: config.openai.apiKey });

export async function transcribeAudio(audioBuffer: Buffer): Promise<string> {
  const file = new File([audioBuffer], "audio.wav", { type: "audio/wav" });

  const transcription = await openai.audio.transcriptions.create({
    file,
    model: config.openai.whisperModel,
    language: "en",
  });

  return transcription.text;
}
```

### Text-to-Speech

```typescript
// src/voice/text-to-speech.ts
import OpenAI from "openai";
import { config } from "../config";

const openai = new OpenAI({ apiKey: config.openai.apiKey });

export async function generateSpeech(text: string): Promise<Buffer> {
  const response = await openai.audio.speech.create({
    model: config.openai.ttsModel,
    voice: config.openai.ttsVoice,
    input: text,
    speed: config.openai.ttsSpeed,
    response_format: "opus", // Best for Discord
  });

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
```

---

## Database Schema

### SQLite Tables

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- CONVERSATIONS - Chat history for memory/context
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'text' CHECK (source IN ('text', 'voice')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    metadata TEXT  -- JSON for additional context
);

CREATE INDEX idx_conversations_guild_user ON conversations(guild_id, user_id);
CREATE INDEX idx_conversations_created ON conversations(created_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- USER_PREFERENCES - Per-user settings
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS user_preferences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    preference_key TEXT NOT NULL,
    preference_value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, guild_id, preference_key)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- SERVER_EVENTS - Track notable events for daily summaries
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS server_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    event_type TEXT NOT NULL,  -- member_join, member_leave, channel_create, etc.
    event_data TEXT NOT NULL,  -- JSON payload
    actor_id TEXT,             -- User who triggered the event (if applicable)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_server_events_guild ON server_events(guild_id, created_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- MUSIC_HISTORY - Track played songs
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS music_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    requested_by TEXT NOT NULL,
    track_title TEXT NOT NULL,
    track_url TEXT NOT NULL,
    track_duration INTEGER,  -- Duration in seconds
    played_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_music_history_guild ON music_history(guild_id, played_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- DAILY_POST_CONFIG - Per-guild daily post settings
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS daily_post_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL UNIQUE,
    channel_id TEXT NOT NULL,
    enabled BOOLEAN DEFAULT TRUE,
    post_time TEXT DEFAULT '09:00',  -- HH:MM format
    timezone TEXT DEFAULT 'UTC',
    last_post_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## Daily Posts Scheduler

### Scheduler Implementation

```typescript
// src/scheduler/daily-posts.ts
import { CronJob } from "cron";
import { mastra } from "../mastra";
import { getDatabase } from "../database";
import { getDiscordClient } from "../discord/client";
import { logger } from "../utils/logger";

export function startDailyPostScheduler(): void {
  // Run every minute to check for due posts
  const job = new CronJob("* * * * *", async () => {
    await checkAndSendDailyPosts();
  });

  job.start();
  logger.info("Daily post scheduler started");
}

async function checkAndSendDailyPosts(): Promise<void> {
  const db = getDatabase();
  const now = new Date();

  // Find guilds due for daily posts
  const configs = db.query(`
    SELECT * FROM daily_post_config
    WHERE enabled = TRUE
    AND (last_post_at IS NULL OR date(last_post_at) < date('now'))
    AND time(post_time) <= time('now')
  `).all();

  for (const config of configs) {
    await sendDailyPost(config);
  }
}

async function sendDailyPost(config: DailyPostConfig): Promise<void> {
  const client = getDiscordClient();
  const channel = await client.channels.fetch(config.channel_id);

  if (!channel?.isTextBased()) return;

  // Get recent server events for context
  const db = getDatabase();
  const events = db.query(`
    SELECT * FROM server_events
    WHERE guild_id = ?
    AND created_at >= datetime('now', '-1 day')
    ORDER BY created_at DESC
    LIMIT 50
  `).all(config.guild_id);

  // Generate daily post using AI
  const agent = mastra.getAgent("birmel");
  const response = await agent.generate(
    `Generate a friendly daily server update post. Include:
    - A greeting
    - Summary of notable events from the last 24 hours
    - Any tips or reminders for the community

    Recent events: ${JSON.stringify(events)}

    Keep it concise and engaging. Use Discord markdown.`,
    { maxTokens: 500 }
  );

  await channel.send(response.text);

  // Update last post time
  db.run(`
    UPDATE daily_post_config
    SET last_post_at = datetime('now')
    WHERE guild_id = ?
  `, [config.guild_id]);
}
```

---

## Error Handling & Logging

### Structured Logger

```typescript
// src/utils/logger.ts
import { config } from "../config";

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  private level: number;

  constructor() {
    this.level = LOG_LEVELS[config.logging.level];
  }

  private log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (LOG_LEVELS[level] < this.level) return;

    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...meta,
    };

    const output = JSON.stringify(entry);

    if (level === "error") {
      console.error(output);
    } else {
      console.log(output);
    }
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.log("debug", message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.log("info", message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.log("warn", message, meta);
  }

  error(message: string, error?: Error, meta?: Record<string, unknown>): void {
    this.log("error", message, {
      ...meta,
      error: error ? { name: error.name, message: error.message, stack: error.stack } : undefined,
    });
  }
}

export const logger = new Logger();
```

### Error Handling Pattern

```typescript
// All tools use this pattern for consistent error handling
import { logger } from "../../utils/logger";

export const exampleTool = createTool({
  // ... schema
  execute: async ({ context }) => {
    try {
      // Tool implementation
      return { success: true, message: "Action completed" };
    } catch (error) {
      logger.error("Tool execution failed", error as Error, {
        tool: "example-tool",
        context,
      });

      // Return user-friendly error
      return {
        success: false,
        message: error instanceof DiscordAPIError
          ? `Discord error: ${error.message}`
          : "An unexpected error occurred. Please try again.",
      };
    }
  },
});
```

---

## Security Considerations

### Permission Validation

Every administrative tool MUST validate permissions before execution:

```typescript
// src/discord/permissions.ts
import type { GuildMember, PermissionResolvable } from "discord.js";

export function hasPermission(
  member: GuildMember,
  permission: PermissionResolvable
): boolean {
  return member.permissions.has(permission);
}

export function validateToolPermission(
  member: GuildMember,
  requiredPermission: PermissionResolvable,
  toolName: string
): { allowed: boolean; message?: string } {
  if (!hasPermission(member, requiredPermission)) {
    return {
      allowed: false,
      message: `You don't have permission to use ${toolName}. Required: ${String(requiredPermission)}`,
    };
  }
  return { allowed: true };
}
```

### Rate Limiting

```typescript
// src/utils/rate-limiter.ts
const rateLimits = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): boolean {
  const now = Date.now();
  const limit = rateLimits.get(key);

  if (!limit || now > limit.resetAt) {
    rateLimits.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (limit.count >= maxRequests) {
    return false;
  }

  limit.count++;
  return true;
}
```

### Input Sanitization

- All user inputs validated via Zod schemas
- No SQL injection possible with parameterized queries
- Message content sanitized before sending

### Explicitly Forbidden

```typescript
// These operations are NEVER allowed
const FORBIDDEN_OPERATIONS = [
  "delete-guild",      // Cannot delete the server
  "transfer-ownership", // Cannot transfer ownership
];
```

---

## Testing Strategy

### Test Structure

```typescript
// tests/setup.ts
import { beforeAll, afterAll, mock } from "bun:test";

// Mock Discord.js client
mock.module("discord.js", () => ({
  Client: class MockClient {
    guilds = { cache: new Map() };
    channels = { fetch: async () => ({}) };
    // ...
  },
}));

// Mock OpenAI
mock.module("openai", () => ({
  default: class MockOpenAI {
    audio = {
      transcriptions: { create: async () => ({ text: "mock transcription" }) },
      speech: { create: async () => ({ arrayBuffer: async () => new ArrayBuffer(0) }) },
    };
  },
}));
```

### Test Categories

1. **Unit Tests** - Individual functions/utilities
2. **Tool Tests** - Each Mastra tool in isolation
3. **Integration Tests** - Full flow from message to response
4. **Database Tests** - Repository operations

### Coverage Requirements

```toml
# bunfig.toml
[test]
coverage = true
coverageThreshold = { lines = 0.70, functions = 0.70 }
coveragePathIgnorePatterns = [
  "**/node_modules/**",
  "**/tests/**",
]
```

---

## CI/CD Integration

### Dagger Pipeline

```typescript
// .dagger/src/birmel.ts
import { dag, object, func } from "@dagger.io/dagger";

@object()
export class Birmel {
  @func()
  async lint(): Promise<string> {
    return dag
      .container()
      .from("oven/bun:latest")
      .withDirectory("/app", dag.host().directory("packages/birmel"))
      .withWorkdir("/app")
      .withExec(["bun", "install"])
      .withExec(["bun", "run", "lint"])
      .stdout();
  }

  @func()
  async typecheck(): Promise<string> {
    return dag
      .container()
      .from("oven/bun:latest")
      .withDirectory("/app", dag.host().directory("packages/birmel"))
      .withWorkdir("/app")
      .withExec(["bun", "install"])
      .withExec(["bun", "run", "typecheck"])
      .stdout();
  }

  @func()
  async test(): Promise<string> {
    return dag
      .container()
      .from("oven/bun:latest")
      .withDirectory("/app", dag.host().directory("packages/birmel"))
      .withWorkdir("/app")
      .withExec(["bun", "install"])
      .withExec(["bun", "test"])
      .stdout();
  }

  @func()
  async ci(): Promise<string> {
    await this.lint();
    await this.typecheck();
    await this.test();
    return "CI passed";
  }
}
```

---

## Implementation Phases

### Phase 1: Foundation (Steps 1-4)
**Goal:** Basic bot that responds to text messages

1. Create package structure (`package.json`, `tsconfig.json`, `eslint.config.ts`)
2. Implement configuration system with Zod validation
3. Set up Discord.js client with proper intents
4. Implement message handler with trigger detection

**Deliverable:** Bot connects and echoes "I heard you!" when mentioned

---

### Phase 2: Mastra Integration (Steps 5-8)
**Goal:** AI-powered responses

5. Initialize Mastra with Claude
6. Create Birmel agent with system prompt
7. Implement 10 core Discord tools (guild info, send message, kick, ban, etc.)
8. Wire message handler to agent

**Deliverable:** Bot can answer questions and perform basic actions

---

### Phase 3: Full Discord Tools (Steps 9-12)
**Goal:** Complete Discord management

9. Implement channel management tools
10. Implement role management tools
11. Implement moderation tools (timeout, automod)
12. Implement remaining tools (webhooks, invites, emojis, events)

**Deliverable:** Bot can perform any server management action

---

### Phase 4: Music System (Steps 13-15)
**Goal:** YouTube music playback

13. Set up discord-player with extractors
14. Implement music playback tools
15. Implement queue management tools

**Deliverable:** Bot can play music in voice channels

---

### Phase 5: Voice Interaction (Steps 16-19)
**Goal:** Voice commands with speech

16. Implement audio receiver with buffering
17. Integrate OpenAI Whisper for STT
18. Integrate OpenAI TTS for responses
19. Implement voice command routing

**Deliverable:** Bot responds to voice commands

---

### Phase 6: Persistence (Steps 20-22)
**Goal:** Memory and history

20. Set up SQLite with bun:sqlite
21. Implement conversation repository
22. Implement server events tracking

**Deliverable:** Bot remembers conversations

---

### Phase 7: Daily Posts (Steps 23-24)
**Goal:** Automated updates

23. Implement scheduler with cron
24. Create daily post generation job

**Deliverable:** Bot posts daily updates

---

### Phase 8: Polish & Deploy (Steps 25-27)
**Goal:** Production ready

25. Add comprehensive tests
26. Update Dagger CI pipeline
27. Update release-please config

**Deliverable:** Fully tested, CI-integrated bot

---

## Files to Create/Modify

### New Files (packages/birmel/)

```
packages/birmel/
├── package.json
├── tsconfig.json
├── eslint.config.ts
├── bunfig.toml
├── .env.example
├── src/
│   ├── index.ts
│   ├── config/index.ts
│   ├── config/schema.ts
│   ├── config/constants.ts
│   ├── discord/index.ts
│   ├── discord/client.ts
│   ├── discord/intents.ts
│   ├── discord/permissions.ts
│   ├── discord/events/index.ts
│   ├── discord/events/ready.ts
│   ├── discord/events/message-create.ts
│   ├── discord/events/voice-state-update.ts
│   ├── discord/events/guild-create.ts
│   ├── discord/events/guild-delete.ts
│   ├── mastra/index.ts
│   ├── mastra/agents/index.ts
│   ├── mastra/agents/birmel-agent.ts
│   ├── mastra/agents/system-prompt.ts
│   ├── mastra/tools/index.ts
│   ├── mastra/tools/types.ts
│   ├── mastra/tools/discord/index.ts
│   ├── mastra/tools/discord/guild.ts
│   ├── mastra/tools/discord/channels.ts
│   ├── mastra/tools/discord/members.ts
│   ├── mastra/tools/discord/roles.ts
│   ├── mastra/tools/discord/messages.ts
│   ├── mastra/tools/discord/moderation.ts
│   ├── mastra/tools/discord/emojis.ts
│   ├── mastra/tools/discord/events.ts
│   ├── mastra/tools/discord/automod.ts
│   ├── mastra/tools/discord/webhooks.ts
│   ├── mastra/tools/discord/invites.ts
│   ├── mastra/tools/discord/voice.ts
│   ├── mastra/tools/music/index.ts
│   ├── mastra/tools/music/playback.ts
│   ├── mastra/tools/music/queue.ts
│   ├── mastra/tools/music/control.ts
│   ├── mastra/tools/external/index.ts
│   ├── mastra/tools/external/web.ts
│   ├── mastra/tools/external/news.ts
│   ├── mastra/tools/external/lol.ts
│   ├── music/index.ts
│   ├── music/player.ts
│   ├── music/extractors.ts
│   ├── music/events.ts
│   ├── voice/index.ts
│   ├── voice/receiver.ts
│   ├── voice/speech-to-text.ts
│   ├── voice/text-to-speech.ts
│   ├── voice/audio-buffer.ts
│   ├── voice/voice-activity.ts
│   ├── voice/command-handler.ts
│   ├── database/index.ts
│   ├── database/client.ts
│   ├── database/migrations/index.ts
│   ├── database/migrations/001-initial.ts
│   ├── database/migrations/002-music-history.ts
│   ├── database/repositories/index.ts
│   ├── database/repositories/conversations.ts
│   ├── database/repositories/server-events.ts
│   ├── database/repositories/user-preferences.ts
│   ├── database/repositories/music-history.ts
│   ├── scheduler/index.ts
│   ├── scheduler/daily-posts.ts
│   ├── scheduler/jobs/server-summary.ts
│   ├── scheduler/jobs/announcements.ts
│   ├── utils/index.ts
│   ├── utils/logger.ts
│   ├── utils/rate-limiter.ts
│   ├── utils/retry.ts
│   └── utils/audio.ts
└── tests/
    ├── setup.ts
    └── ... (test files)
```

**Total: ~70 new files**

### Existing Files to Modify

| File | Change |
|------|--------|
| `/Users/jerred/git/monorepo/package.json` | Add `packages/birmel` to workspaces |
| `/Users/jerred/git/monorepo/.dagger/src/index.ts` | Add birmel CI functions |
| `/Users/jerred/git/monorepo/release-please-config.json` | Add birmel package config |
| `/Users/jerred/git/monorepo/.release-please-manifest.json` | Add birmel version entry |

---

## Summary

**Birmel** is a comprehensive Discord server management bot with:

- **80+ Discord management tools** covering all server operations except deletion
- **Natural language processing** via Mastra + Claude
- **Voice interaction** with OpenAI Whisper (STT) and TTS
- **Music playback** with YouTube support via discord-player
- **Persistent memory** with SQLite for conversations and preferences
- **Daily automated posts** with AI-generated content
- **Production-ready** with comprehensive testing and CI/CD

The implementation follows your established patterns from scout-for-lol and homelab:
- Maximum TypeScript strictness
- Bun-first APIs
- Zod validation
- Dagger CI
- Conventional commits
