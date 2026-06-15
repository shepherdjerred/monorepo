import {
  Client as BotClient,
  Events,
  GatewayIntentBits,
  type Interaction,
  type VoiceState,
} from "discord.js";
import {
  buildPlayCommand,
  handlePlayCommand,
} from "@shepherdjerred/discord-stream-lifecycle/discord/play-command.ts";
import {
  buildStopCommand,
  handleStopCommand,
  type StopPermissionMode,
} from "@shepherdjerred/discord-stream-lifecycle/discord/stop-command.ts";
import {
  registerGameBotCommands,
  type RegisterableCommand,
} from "@shepherdjerred/discord-stream-lifecycle/discord/command-registration.ts";
import type { GameDriver } from "./game-driver.ts";
import type { PooledUserbot } from "@shepherdjerred/discord-stream-lifecycle/pool/pooled-userbot.ts";
import { UserbotPool } from "@shepherdjerred/discord-stream-lifecycle/pool/userbot-pool.ts";
import type { PooledUserbotFactory } from "@shepherdjerred/discord-stream-lifecycle/pool/pooled-userbot.ts";
import {
  AloneInVoiceWatcher,
  type VoiceOccupancySnapshot,
} from "@shepherdjerred/discord-stream-lifecycle/session/auto-leave.ts";
import {
  SingleSlotSessionManager,
  type SessionManagerLogger,
} from "@shepherdjerred/discord-stream-lifecycle/session/session-manager.ts";

export type ExtraSlashCommand = {
  readonly builder: RegisterableCommand;
  readonly handle: (interaction: Interaction) => Promise<void>;
};

export type CreateGameBotOptions<TUserbot extends PooledUserbot> = {
  /** Bot token (real bot, not selfbot) for the gateway connection that registers commands. */
  readonly botToken: string;
  /** Application id for the bot (used to register global slash commands). */
  readonly applicationId: string;
  /** Selfbot user tokens for the pool. */
  readonly userbotTokens: readonly string[];
  /** Factory that turns a token into a PooledUserbot. */
  readonly userbotFactory: PooledUserbotFactory<TUserbot>;
  /** Per-game lifecycle hook (boot emulator, start streamer, etc.). */
  readonly driver: GameDriver<TUserbot>;
  /** Root dir under which `<guildId>/` session dirs live. */
  readonly stateRootDir: string;
  /** Extra per-game slash commands (`/screenshot`, `/goal`, ...). */
  readonly extraCommands?: readonly ExtraSlashCommand[];
  /** Who can run `/stop`? Default: anyMember. */
  readonly stopPermission?: StopPermissionMode;
  /** Grace period when the voice channel goes empty before firing `aloneInVoice` stop. */
  readonly aloneGraceMs?: number;
  /** Optional logger. */
  readonly logger?: SessionManagerLogger;
};

/** Live runtime returned by `createGameBot` — call `start()` once to bring everything up. */
export type GameBotRuntime<TUserbot extends PooledUserbot> = {
  readonly bot: BotClient;
  readonly pool: UserbotPool<TUserbot>;
  readonly sessionManager: SingleSlotSessionManager<TUserbot>;
  readonly aloneWatcher: AloneInVoiceWatcher;
  readonly start: () => Promise<void>;
  readonly shutdown: () => Promise<void>;
};

/**
 * Build a complete game-bot runtime: pool + single-slot session manager + bot client
 * with `/play` and `/stop` wired up + voice-state-update auto-leave. The caller invokes
 * `start()` once to log in the bot + pool, register commands, and arm event handlers.
 *
 * Game-bots typically just do:
 *   const runtime = createGameBot({ driver: new PokemonGameDriver(...), ... });
 *   await runtime.start();
 */
export function createGameBot<TUserbot extends PooledUserbot>(
  options: CreateGameBotOptions<TUserbot>,
): GameBotRuntime<TUserbot> {
  const log: SessionManagerLogger = options.logger ?? {
    info: () => {
      /* silent default */
    },
    warn: () => {
      /* silent default */
    },
    error: () => {
      /* silent default */
    },
  };

  const bot = new BotClient({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });
  const pool = new UserbotPool<TUserbot>({
    tokens: options.userbotTokens,
    factory: options.userbotFactory,
    logger: log,
  });
  const sessionManager = new SingleSlotSessionManager<TUserbot>({
    pool,
    driver: options.driver,
    stateRootDir: options.stateRootDir,
    logger: log,
  });
  const aloneWatcher = new AloneInVoiceWatcher(
    options.aloneGraceMs === undefined
      ? { logger: log }
      : { aloneGraceMs: options.aloneGraceMs, logger: log },
  );

  const runtime: GameBotRuntime<TUserbot> = {
    bot,
    pool,
    sessionManager,
    aloneWatcher,
    start: async () => {
      await pool.start();
      await registerGameBotCommands({
        applicationId: options.applicationId,
        token: options.botToken,
        commands: [
          buildPlayCommand({}),
          buildStopCommand({}),
          ...(options.extraCommands?.map((cmd) => cmd.builder) ?? []),
        ],
      });
      bot.on(Events.InteractionCreate, (interaction) => {
        void handleInteraction(
          interaction,
          sessionManager,
          options.extraCommands ?? [],
          options.stopPermission ?? "anyMember",
        );
      });
      bot.on(Events.VoiceStateUpdate, (oldState, newState) => {
        handleVoiceStateUpdate(
          oldState,
          newState,
          sessionManager,
          aloneWatcher,
        );
      });
      await bot.login(options.botToken);
      log.info("game bot ready", {
        driver: options.driver.name,
        poolSize: pool.size(),
        guildsServed: pool.serveableGuildIds().size,
      });
    },
    shutdown: async () => {
      aloneWatcher.cancel();
      await sessionManager.stop("shutdown");
      try {
        await bot.destroy();
      } catch {
        // bot.destroy() can throw if never fully ready — harmless on shutdown.
      }
      await pool.destroy();
    },
  };
  return runtime;
}

async function handleInteraction<TUserbot extends PooledUserbot>(
  interaction: Interaction,
  sessionManager: SingleSlotSessionManager<TUserbot>,
  extraCommands: readonly ExtraSlashCommand[],
  stopPermission: StopPermissionMode,
): Promise<void> {
  if (!interaction.isChatInputCommand()) {
    return;
  }
  switch (interaction.commandName) {
    case "play":
      await handlePlayCommand(interaction, sessionManager);
      return;
    case "stop":
      await handleStopCommand(interaction, sessionManager, {
        permissionMode: stopPermission,
      });
      return;
    default: {
      const extra = extraCommands.find(
        (cmd) => cmd.builder.name === interaction.commandName,
      );
      if (extra !== undefined) {
        await extra.handle(interaction);
      }
    }
  }
}

function handleVoiceStateUpdate<TUserbot extends PooledUserbot>(
  oldState: VoiceState,
  newState: VoiceState,
  sessionManager: SingleSlotSessionManager<TUserbot>,
  aloneWatcher: AloneInVoiceWatcher,
): void {
  const session = sessionManager.getActiveSession();
  if (session === null) {
    return;
  }
  const relevantGuild = oldState.guild.id === session.guildId;
  if (!relevantGuild) {
    return;
  }
  const channel = oldState.guild.channels.cache.get(session.voiceChannelId);
  if (channel === undefined) {
    return;
  }
  if (!channel.isVoiceBased()) {
    return;
  }
  const userbotId = session.userbotEntry.userbot.userId();
  const humanMemberCount = [...channel.members.values()].filter(
    (member) => !member.user.bot && member.id !== userbotId,
  ).length;
  const snapshot: VoiceOccupancySnapshot = {
    guildId: session.guildId,
    voiceChannelId: session.voiceChannelId,
    humanMemberCount,
  };
  aloneWatcher.evaluate(session, snapshot, () => {
    void sessionManager.stop("aloneInVoice");
  });
  // Suppress unused-param warning for newState (kept for future expansion to detect moves).
  void newState;
}
