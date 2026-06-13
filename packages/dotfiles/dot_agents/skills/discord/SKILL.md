---
name: discord
description: |
  Interact with Discord live as an agent — send/read messages, invoke other bots' slash commands, join voice channels — by writing and running short TypeScript scripts with Bun.
  Use when testing or iterating on Discord bots, verifying bot behavior on a real server, or when any task needs to act on Discord directly.
---

# Discord Agent Access

Interact with Discord by **writing short TypeScript scripts and running them with Bun** — there is no MCP server or wrapper CLI for this on purpose. All snippets below were verified live on 2026-06-12.

## Credentials — ask the user

**Do not assume which Discord credentials to use.** Ask the user which 1Password item (or env vars) holds the right tokens for the task, and which server/channels to target. Different bots and tasks use different identities.

Load all needed fields with **one** batched `op` call (each `op` invocation needs manual approval). Example shape — substitute the item/vault/field labels the user gives you:

```bash
bash -c 'J=$(op item get <ITEM> --vault "<VAULT>" --format json --reveal) \
  && export BOT_TOKEN=$(echo "$J" | jq -r ".fields[]|select((.label//.id)==\"BOT_TOKEN\").value") \
  && export TOKEN=$(echo "$J" | jq -r ".fields[]|select((.label//.id)==\"TOKEN\").value") \
  && bun run <your-script>.ts'
```

Never write tokens to files or print them to logs — env vars only, loaded in the same command that runs the script.

## Identities: userbot vs bot

| Identity type | Library | Use for |
| --- | --- | --- |
| Userbot (selfbot, a real user account) | `discord.js-selfbot-v13` | Invoking **other bots' slash commands** (`sendSlash`), joining voice as a regular user, acting like a human tester |
| Bot (application token) | `discord.js` v14 | Plain send/read, observing guild state (voice states, messages), registering throwaway slash commands |

A bot **cannot** invoke another bot's slash commands or appear as a user in voice — that's what a userbot is for. The selfbot library is archived upstream (Oct 2025) but still works.

Scripts may act on **any** server the chosen identity is in — confirm the target guild/channel IDs with the user. A userbot is a real account, so be deliberate in shared/production servers.

## Where scripts live & how to run

Set up a throwaway scratch dir (the explicit `debug` is required — a transitive dep of the selfbot lib fails to declare it and fresh installs break without it):

```bash
mkdir -p /tmp/discord-scratch && cd /tmp/discord-scratch \
  && bun add discord.js@^14 discord.js-selfbot-v13@^3.7 debug
```

Write your script there and run it with `bun run` (tokens via env, see above). If you're working inside a repo that already has these deps installed, a gitignored scratch dir inside that package works too.

## Script skeleton (login, teardown, watchdog)

```typescript
import { Client as BotClient, GatewayIntentBits } from "discord.js";
import { Client as UserClient } from "discord.js-selfbot-v13";

const GUILD_ID = "<target guild — confirm with the user>";

const botToken = Bun.env["BOT_TOKEN"];
const userToken = Bun.env["TOKEN"];
if (botToken === undefined || botToken === "" || userToken === undefined || userToken === "") {
  throw new Error("BOT_TOKEN and TOKEN must be set");
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

const bot = new BotClient({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // needed to read message content
    GatewayIntentBits.GuildVoiceStates, // needed to observe voice states
  ],
});
const user = new UserClient();

try {
  const botReady = waitForReady(bot, "bot");
  await bot.login(botToken);
  await botReady;
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
  await bot.destroy();
  clearTimeout(watchdog);
}
```

Only log in the identity you need — most read-only checks need just the bot.

## Send & read messages

```typescript
const TEXT_CHANNEL_ID = "<target channel>";

// userbot sends (works the same with the bot client)
const userChannel = await user.channels.fetch(TEXT_CHANNEL_ID);
if (userChannel === null || !("send" in userChannel)) {
  throw new Error("channel not sendable");
}
await userChannel.send("hello from the agent");

// bot reads recent history
import { ChannelType } from "discord.js";
const botChannel = await bot.channels.fetch(TEXT_CHANNEL_ID);
if (botChannel === null || botChannel.type !== ChannelType.GuildText) {
  throw new Error("not a guild text channel");
}
const recent = await botChannel.messages.fetch({ limit: 10 });
for (const message of recent.values()) {
  console.log(`${message.author.tag}: ${message.content} [embeds: ${String(message.embeds.length)}]`);
}
```

To wait for a bot's reply, listen for `Events.MessageCreate` (or `Events.InteractionCreate` on your own throwaway bot) with a `setTimeout` race.

## Invoke another bot's slash command (userbot only)

```typescript
const targetBotId = "<the bot's user id>";
// command must already be registered in the target guild by the target bot
await userChannel.sendSlash(targetBotId, "play", "https://example.com/video.mp4");
```

- Args follow the command name positionally; subcommands go in the name string (`"queue list"`).
- If the command was registered seconds ago, wait ~3s first — the command cache lags.
- Errors like `Command not found` usually mean the target bot never registered the command **in that guild**.

For a fully self-contained round-trip test, register a throwaway command with your own bot first:

```typescript
import { Events, REST, Routes, SlashCommandBuilder } from "discord.js";

const rest = new REST().setToken(botToken);
const command = new SlashCommandBuilder().setName("agent-ping").setDescription("test ping");
const botUserId = bot.user?.id;
if (botUserId === undefined) throw new Error("bot user not available after ready");
await rest.put(Routes.applicationGuildCommands(botUserId, GUILD_ID), { body: [command.toJSON()] });

const interactionSeen = new Promise<boolean>((resolve) => {
  const timer = setTimeout(() => {
    resolve(false);
  }, 20_000);
  bot.on(Events.InteractionCreate, (interaction) => {
    if (interaction.isChatInputCommand() && interaction.commandName === "agent-ping") {
      clearTimeout(timer);
      void interaction.reply("pong");
      resolve(true);
    }
  });
});
await new Promise((resolve) => setTimeout(resolve, 3_000)); // registration → cache lag
await userChannel.sendSlash(botUserId, "agent-ping");
console.log(`round-trip ok: ${String(await interactionSeen)}`);
// cleanup so the guild stays tidy
await rest.put(Routes.applicationGuildCommands(botUserId, GUILD_ID), { body: [] });
```

## Join voice / verify a stream

Do **NOT** use `user.voice.joinChannel(...)` — it attempts a full media handshake with deprecated encryption modes and dies with `VOICE_CONNECTION_TIMEOUT`. To just *be present* in a voice channel (which is all you need to observe or trigger streaming behavior), send a raw gateway VoiceStateUpdate (op 4):

```typescript
const VOICE_CHANNEL_ID = "<target voice channel>";

// join (presence only, no audio/video)
user.ws.broadcast({
  op: 4,
  d: {
    guild_id: GUILD_ID,
    channel_id: VOICE_CHANNEL_ID,
    self_mute: true,
    self_deaf: false,
    self_video: false,
  },
});
await new Promise((resolve) => setTimeout(resolve, 3_000)); // let the state propagate

// observe voice states from the bot side (needs GuildVoiceStates intent)
const guild = await bot.guilds.fetch(GUILD_ID);
for (const [memberId, voiceState] of guild.voiceStates.cache) {
  // voiceState.streaming === true → that member has a live Go-Live stream
  console.log(`${memberId} in ${String(voiceState.channelId)} streaming=${String(voiceState.streaming)} video=${String(voiceState.selfVideo)}`);
}

// leave
user.ws.broadcast({
  op: 4,
  d: { guild_id: GUILD_ID, channel_id: null, self_mute: true, self_deaf: false, self_video: false },
});
```

To actually **send** video/audio into a channel, use `@shepherdjerred/discord-video-stream` (a maintained fork of `@dank074/discord-video-stream`) — its `Streamer` class drives the full media pipeline via ffmpeg. Usually the bot under test does the streaming while your script observes.

## Gotchas

- Fresh installs of the selfbot lib fail at import time with `Cannot find package 'debug'` (undeclared transitive dep via werift-rtp) — always `bun add debug` alongside it.
- discord.js v14 logs a `DeprecationWarning` about `ready` → `clientReady`; harmless, ignore it.
- The selfbot lib's `destroy()` can throw (`this.connection.readyState` on null) — always wrap it (see skeleton).
- Reading message *content* from the bot requires the privileged `MessageContent` intent (enabled per-application in the Discord developer portal).
- Scripts that don't tear down both clients won't exit — Bun keeps the gateway sockets alive. Keep the watchdog.
- One `op` call per session: fetch all fields you need in a single `op item get`.

## Related

- `discord-bot-helper` skill — building bots with discord.js v14 (this skill is about *acting on* Discord, not building bots).
