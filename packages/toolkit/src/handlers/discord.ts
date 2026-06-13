import { parseArgs } from "node:util";
import {
  daemonStartCommand,
  daemonStatusCommand,
  daemonStopCommand,
} from "#commands/discord/daemon.ts";
import { channelsCommand, guildsCommand } from "#commands/discord/info.ts";
import {
  readCommand,
  sendCommand,
  waitCommand,
} from "#commands/discord/messages.ts";
import { slashCommand } from "#commands/discord/slash.ts";
import {
  voiceJoinCommand,
  voiceLeaveCommand,
  voiceStatesCommand,
} from "#commands/discord/voice.ts";
import {
  DEFAULT_TTL_SECONDS,
  IdentityKindSchema,
  parseTtl,
} from "#lib/discord/ipc.ts";

const USAGE = `
toolkit discord — act on Discord through a session daemon

Daemon (start once per session; tokens from env, one op call):
  toolkit discord daemon start [--ttl 4h]   Needs DISCORD_BOT_TOKEN and/or DISCORD_USER_TOKEN
  toolkit discord daemon status [--json]
  toolkit discord daemon stop

Commands (talk to the running daemon):
  toolkit discord whoami                                 Identities, uptime, voice presence
  toolkit discord guilds [--json]                        List guilds per identity
  toolkit discord channels <guildId> [--json]            List channels
  toolkit discord send <channelId> <message…> [--as bot|user]
  toolkit discord read <channelId> [-n 20] [--json]      Recent messages (incl. embeds)
  toolkit discord wait <channelId> [--from <userId>] [--contains <str>] [--timeout 30]
  toolkit discord slash <channelId> <botId> <command> [args…]   Invoke another bot's slash command (userbot)
  toolkit discord voice join <channelId>                 Userbot joins VC; presence persists
  toolkit discord voice leave
  toolkit discord voice states <guildId> [--json]        Who's in VC, streaming flags
`;

function parseJsonFlag(args: string[]) {
  return parseArgs({
    args,
    options: { json: { type: "boolean", default: false } },
    allowPositionals: true,
  });
}

function requirePositional(
  positionals: string[],
  index: number,
  name: string,
  usage: string,
): string {
  const value = positionals[index];
  if (value == null || value.length === 0) {
    console.error(`Error: ${name} is required`);
    console.error(`Usage: ${usage}`);
    process.exit(1);
  }
  return value;
}

async function handleDaemon(args: string[]): Promise<void> {
  const action = args[0] ?? "";
  const rest = args.slice(1);
  switch (action) {
    case "start": {
      const { values } = parseArgs({
        args: rest,
        options: { ttl: { type: "string" } },
        allowPositionals: false,
      });
      const ttlSeconds =
        values.ttl == null ? DEFAULT_TTL_SECONDS : parseTtl(values.ttl);
      await daemonStartCommand({ ttlSeconds });
      break;
    }
    case "stop": {
      await daemonStopCommand();
      break;
    }
    case "status": {
      const { values } = parseJsonFlag(rest);
      await daemonStatusCommand({ json: values.json });
      break;
    }
    default:
      console.error("Usage: toolkit discord daemon start|stop|status");
      process.exit(1);
  }
}

async function handleSend(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      json: { type: "boolean", default: false },
      as: { type: "string" },
    },
    allowPositionals: true,
  });
  const channelId = requirePositional(
    positionals,
    0,
    "channel id",
    "toolkit discord send <channelId> <message…> [--as bot|user]",
  );
  const content = positionals.slice(1).join(" ");
  if (content.length === 0) {
    console.error("Error: message content is required");
    process.exit(1);
  }
  const as =
    values.as == null ? undefined : IdentityKindSchema.parse(values.as);
  await sendCommand(channelId, content, { as, json: values.json });
}

async function handleRead(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      json: { type: "boolean", default: false },
      n: { type: "string", short: "n" },
    },
    allowPositionals: true,
  });
  const channelId = requirePositional(
    positionals,
    0,
    "channel id",
    "toolkit discord read <channelId> [-n 20] [--json]",
  );
  const limit = values.n == null ? 20 : Number.parseInt(values.n, 10);
  await readCommand(channelId, { limit, json: values.json });
}

async function handleWait(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      json: { type: "boolean", default: false },
      from: { type: "string" },
      contains: { type: "string" },
      timeout: { type: "string" },
    },
    allowPositionals: true,
  });
  const channelId = requirePositional(
    positionals,
    0,
    "channel id",
    "toolkit discord wait <channelId> [--from <userId>] [--contains <str>] [--timeout 30]",
  );
  const timeoutSeconds =
    values.timeout == null ? 30 : Number.parseInt(values.timeout, 10);
  await waitCommand(channelId, {
    fromUserId: values.from,
    contains: values.contains,
    timeoutSeconds,
    json: values.json,
  });
}

async function handleSlash(args: string[]): Promise<void> {
  const { values, positionals } = parseJsonFlag(args);
  const usage = "toolkit discord slash <channelId> <botId> <command> [args…]";
  const channelId = requirePositional(positionals, 0, "channel id", usage);
  const botId = requirePositional(positionals, 1, "bot id", usage);
  const command = requirePositional(positionals, 2, "command name", usage);
  await slashCommand({
    channelId,
    botId,
    command,
    args: positionals.slice(3),
    json: values.json,
  });
}

async function handleVoice(args: string[]): Promise<void> {
  const action = args[0] ?? "";
  const rest = args.slice(1);
  switch (action) {
    case "join": {
      const { values, positionals } = parseJsonFlag(rest);
      const channelId = requirePositional(
        positionals,
        0,
        "voice channel id",
        "toolkit discord voice join <channelId>",
      );
      await voiceJoinCommand(channelId, { json: values.json });
      break;
    }
    case "leave": {
      const { values } = parseJsonFlag(rest);
      await voiceLeaveCommand({ json: values.json });
      break;
    }
    case "states": {
      const { values, positionals } = parseJsonFlag(rest);
      const guildId = requirePositional(
        positionals,
        0,
        "guild id",
        "toolkit discord voice states <guildId> [--json]",
      );
      await voiceStatesCommand(guildId, { json: values.json });
      break;
    }
    default:
      console.error("Usage: toolkit discord voice join|leave|states");
      process.exit(1);
  }
}

export async function handleDiscordCommand(
  subcommand: string | undefined,
  args: string[],
): Promise<void> {
  try {
    switch (subcommand) {
      case "daemon":
        await handleDaemon(args);
        break;
      case "serve": {
        // hidden: the daemon process itself, spawned by `daemon start`
        const { runDiscordDaemon } = await import("#lib/discord/serve.ts");
        await runDiscordDaemon();
        break;
      }
      case "whoami":
        await daemonStatusCommand({ json: parseJsonFlag(args).values.json });
        break;
      case "guilds":
        await guildsCommand({ json: parseJsonFlag(args).values.json });
        break;
      case "channels": {
        const { values, positionals } = parseJsonFlag(args);
        const guildId = requirePositional(
          positionals,
          0,
          "guild id",
          "toolkit discord channels <guildId> [--json]",
        );
        await channelsCommand(guildId, { json: values.json });
        break;
      }
      case "send":
        await handleSend(args);
        break;
      case "read":
        await handleRead(args);
        break;
      case "wait":
        await handleWait(args);
        break;
      case "slash":
        await handleSlash(args);
        break;
      case "voice":
        await handleVoice(args);
        break;
      case undefined:
      case "--help":
      case "help":
        console.log(USAGE);
        break;
      default:
        console.error(`Unknown discord subcommand: ${subcommand}`);
        console.log(USAGE);
        process.exit(1);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
