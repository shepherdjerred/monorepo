---
name: discord
description: |
  Interact with Discord live as an agent — send/read messages, invoke other bots' slash commands, join voice channels. Use the `toolkit discord` daemon for common ops, or write a Bun/TypeScript script for anything it doesn't cover.
  Use when testing or iterating on Discord bots, verifying bot behavior on a real server, or when any task needs to act on Discord directly.
---

# Discord Agent Access

Two ways to act on Discord, both verified live on 2026-06-12:

1. **`toolkit discord`** (recommended for common ops) — a session daemon that logs in once, holds the gateway connections in memory, and exposes one-shot CLI commands. One `op` call per session; no boilerplate; voice presence persists between commands.
2. **Write a Bun/TypeScript script** (escape hatch) — for anything the CLI doesn't cover. Same libraries underneath.

## Credentials — ask the user

**Do not assume which Discord credentials to use.** Ask the user which 1Password item (or env vars) holds the right tokens, and which server/channels to target. Different bots and tasks use different identities.

There is a **default test identity** (a throwaway Discord user account, userbot only) for quick checks:

```bash
export DISCORD_USER_TOKEN=$(op read "op://Personal/sskm6skq3mwnyqnhrmqwji6dne/TOKEN")
```

For a bot identity (needed for `voice states` and for reading message content reliably), ask the user for the bot token and export it as `DISCORD_BOT_TOKEN`. Never write tokens to files or print them to logs — env vars only, loaded in the same command that starts the daemon.

## Identities: userbot vs bot

| Identity | Env var | Library | Use for |
| --- | --- | --- | --- |
| Userbot (selfbot, a real user account) | `DISCORD_USER_TOKEN` | `discord.js-selfbot-v13` | Invoking **other bots' slash commands** (`sendSlash`), joining voice as a regular user, acting like a human tester |
| Bot (application token) | `DISCORD_BOT_TOKEN` | `discord.js` v14 | Plain send/read, observing voice states, registering throwaway slash commands |

A bot **cannot** invoke another bot's slash commands or appear as a user in voice — that's what a userbot is for. The selfbot library is archived upstream (Oct 2025) but still works. The daemon accepts either or both tokens (at least one required); commands route to whichever identity they need.

## `toolkit discord` — the daemon

Start it once per session with the tokens in env (one `op` call). The daemon prints the logged-in identities and stays up until you stop it or it idles out (default 4h, `--ttl 30m` to shorten):

```bash
bash -c 'export DISCORD_USER_TOKEN=$(op read "op://Personal/sskm6skq3mwnyqnhrmqwji6dne/TOKEN") \
  && toolkit discord daemon start --ttl 30m'
```

Then every other command talks to the running daemon over a unix socket (no token, no login cost):

```bash
toolkit discord whoami                          # identities, uptime, voice presence
toolkit discord guilds                          # servers per identity
toolkit discord channels <guildId>              # channels (id, name, type)
toolkit discord send <channelId> "hello"        # send (add --as user|bot to choose identity)
toolkit discord read <channelId> -n 20          # recent messages, including embeds
toolkit discord wait <channelId> --contains foo --timeout 30   # block until a matching message arrives
toolkit discord slash <channelId> <botId> play "https://…"     # invoke another bot's slash command (userbot)
toolkit discord voice join <channelId>          # userbot joins VC; presence persists across commands
toolkit discord voice states <guildId>          # who's in VC + streaming/video flags (needs a bot identity)
toolkit discord voice leave
toolkit discord daemon stop
```

All commands print markdown by default; add `--json` for machine-readable output. The streambot test loop is just: `voice states <guild>` and check whose `streaming` flag is set.

Daemon logs (structured JSON, no secrets) are in `~/.toolkit/discord/logs/`. If `daemon start` reports it didn't become ready, read that log for the real error.

## Writing a script (escape hatch)

When the CLI doesn't cover something, write a short Bun script. Set up a throwaway scratch dir (the explicit `debug` is required — a transitive dep of the selfbot lib, werift-rtp, fails to declare it and fresh installs break without it):

```bash
mkdir -p /tmp/discord-scratch && cd /tmp/discord-scratch \
  && bun add discord.js@^14 discord.js-selfbot-v13@^3.7 debug
```

Run it with the tokens in env (`bash -c '… && bun run script.ts'`).

### Script skeleton (login, teardown, watchdog)

```typescript
import { Client as BotClient, GatewayIntentBits } from "discord.js";
import { Client as UserClient } from "discord.js-selfbot-v13";

const GUILD_ID = "<target guild — confirm with the user>";

const botToken = Bun.env["DISCORD_BOT_TOKEN"];
const userToken = Bun.env["DISCORD_USER_TOKEN"];
if (userToken === undefined || userToken === "") {
  throw new Error("DISCORD_USER_TOKEN must be set");
}

// Hard kill so a hung gateway never leaves the process dangling.
const watchdog = setTimeout(() => {
  console.error("TIMEOUT");
  process.exit(1);
}, 120_000);

function waitForReady(client: { once: (event: string, fn: () => void) => unknown }, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} not ready after 30s`));
    }, 30_000);
    client.once("ready", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

const user = new UserClient();

try {
  const userReady = waitForReady(user, "userbot");
  await user.login(userToken);
  await userReady;

  // ... your interaction here ...
} finally {
  // selfbot destroy() throws if its websocket is already gone — never let teardown mask the real error
  try {
    user.destroy();
  } catch (error) {
    console.error(`userbot destroy failed: ${String(error)}`);
  }
  clearTimeout(watchdog);
}
```

Add a `BotClient` (intents `Guilds`, `GuildMessages`, `MessageContent`, `GuildVoiceStates`) only if you need the bot identity.

### Send & read

```typescript
const userChannel = await user.channels.fetch("<channelId>");
if (userChannel === null || !("send" in userChannel)) {
  throw new Error("channel not sendable");
}
await userChannel.send("hello from the agent");

const recent = await userChannel.messages.fetch({ limit: 10 });
for (const message of recent.values()) {
  console.log(`${message.author.tag}: ${message.content}`);
}
```

### Invoke another bot's slash command (userbot only)

```typescript
// command must already be registered in the target guild by the target bot
await userChannel.sendSlash("<targetBotId>", "play", "https://example.com/video.mp4");
```

- Args follow the command name positionally; subcommands go in the name string (`"queue list"`).
- If the command was registered seconds ago, wait ~3s first — the command cache lags.
- `Command not found` usually means the target bot never registered it **in that guild**.

### Join voice / verify a stream

Do **NOT** use `user.voice.joinChannel(...)` — it attempts a full media handshake with deprecated encryption modes and dies with `VOICE_CONNECTION_TIMEOUT`. To just *be present* in a voice channel, send a raw gateway VoiceStateUpdate (op 4):

```typescript
user.ws.broadcast({
  op: 4,
  d: { guild_id: GUILD_ID, channel_id: "<voiceChannelId>", self_mute: true, self_deaf: false, self_video: false },
});
// to leave: same broadcast with channel_id: null
```

Observe streaming from a **bot** client (needs `GuildVoiceStates`): `guild.voiceStates.cache` — `voiceState.streaming === true` means a live Go-Live stream. To actually send media into a channel, use `@shepherdjerred/discord-video-stream` (a maintained fork of `@dank074/discord-video-stream`); usually the bot under test does the streaming while you observe.

## Gotchas

- Fresh installs of the selfbot lib fail at import with `Cannot find package 'debug'` (undeclared transitive dep via werift-rtp) — always `bun add debug` alongside it.
- The selfbot lib's `destroy()` can throw (`this.connection.readyState` on null) — always wrap it.
- Reading message *content* from a bot needs the privileged `MessageContent` intent (enabled per-application in the Discord developer portal).
- A script that doesn't tear down its clients won't exit — Bun keeps the gateway sockets alive. Keep the watchdog.
- One `op` call per session: load every token you need in a single command.

## Related

- `discord-bot-helper` skill — building bots with discord.js v14 (this skill is about *acting on* Discord, not building bots).
