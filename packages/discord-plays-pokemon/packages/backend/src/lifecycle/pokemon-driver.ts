import path from "node:path";
import type { Client as BotClient } from "discord.js";
import type { GameDriver } from "@shepherdjerred/discord-stream-lifecycle/lifecycle/game-driver.ts";
import type {
  Session,
  SessionStopReason,
} from "@shepherdjerred/discord-stream-lifecycle/session/session.ts";
import type { SelfbotPooledUserbot } from "@shepherdjerred/discord-stream-lifecycle/pool/selfbot-client.ts";
import { Emulator, type EmulatorOptions } from "#src/emulator/emulator.ts";
import {
  framesFromMs,
  type CommandTiming,
} from "#src/emulator/command-sink.ts";
import { encodePng } from "#src/emulator/png.ts";
import {
  GameStreamer,
  type GameStreamerOptions,
} from "#src/stream/game-streamer.ts";
import { GoalManager } from "#src/goal/goal-manager.ts";
import { checkpointWithRetry } from "#src/goal/goal-checkpoint.ts";
import type { GoalDiscordMessage } from "#src/goal/goal-types.ts";
import {
  startGoalControlServer,
  type GoalControlServer,
} from "#src/goal/control/control-server.ts";
import { createGameEventWatcher } from "#src/game/events/watcher.ts";
import { readGameSnapshot } from "#src/game/events/snapshot.ts";
import { readSpatialSnapshot } from "#src/game/spatial/spatial-snapshot.ts";
import {
  createEventNotifier,
  type EventToggles,
} from "#src/discord/event-notifier.ts";
import type { Config } from "#src/config/schema.ts";
import { logger } from "#src/logger.ts";

export const POKEMON_SAVE_FILE = "pokeemerald.flash";
export const POKEMON_GOAL_STATE_FILE = "goal-state.json";
export const POKEMON_GOAL_MEMORY_DIR = "goal-memory";

/**
 * A guild's progress: snapshotted into `saves/<guildId>/history/` before every
 * session. Goal screenshots are diagnostics, not progress, and stay out.
 */
export const POKEMON_SAVE_HISTORY_ENTRIES = [
  POKEMON_SAVE_FILE,
  POKEMON_GOAL_STATE_FILE,
  POKEMON_GOAL_MEMORY_DIR,
] as const;

/** The streamer surface a session drives; GameStreamer in production. */
export type SessionStreamer = Pick<
  GameStreamer,
  "login" | "start" | "stop" | "destroy" | "pushFrame" | "pushAudio"
>;

/** Seams for building a session's emulator and streamer (tests substitute fakes). */
export type PokemonDriverFactories = {
  readonly createEmulator: (options: EmulatorOptions) => Emulator;
  readonly createStreamer: (options: GameStreamerOptions) => SessionStreamer;
};

const defaultFactories: PokemonDriverFactories = {
  createEmulator: (options) => new Emulator(options),
  createStreamer: (options) => new GameStreamer(options),
};

/**
 * Per-pokemon-session runtime — owns the emulator, streamer, goal manager, control
 * server, and event notifier for ONE active game. The driver creates everything on
 * `/play` and tears it all down on `/stop` (or auto-leave / idle / shutdown).
 *
 * Persistence is keyed by `session.sessionDir` so two Discord servers playing pokemon
 * never see each other's save or goal history — A's `pokeemerald.flash` lives at
 * `saves/<A>/pokeemerald.flash`, B's at `saves/<B>/pokeemerald.flash`.
 */
export class PokemonGameDriver implements GameDriver<SelfbotPooledUserbot> {
  readonly name = "Pokémon";
  private readonly config: Config;
  /**
   * Guilds where `/goal` may run. The goal agent has full filesystem access in
   * the pod, so it is a capability grant limited to trusted servers; every
   * other guild plays without goal mode.
   */
  private readonly goalGuildIds: ReadonlySet<string>;
  private readonly factories: PokemonDriverFactories;
  private botClient: BotClient | null = null;
  /** Per-active-session bag of teardown handles. Null when idle. */
  private active: ActiveSessionRuntime | null = null;

  constructor(params: {
    config: Config;
    goalGuildIds: ReadonlySet<string>;
    factories?: PokemonDriverFactories;
  }) {
    this.config = params.config;
    this.goalGuildIds = params.goalGuildIds;
    this.factories = params.factories ?? defaultFactories;
  }

  /** Whether `/goal` is available to sessions in `guildId`. */
  goalEnabledForGuild(guildId: string): boolean {
    return this.config.game.goal.enabled && this.goalGuildIds.has(guildId);
  }

  /** Wire the bot client after createGameBot constructs it. Must be called before /play. */
  setBotClient(client: BotClient): void {
    this.botClient = client;
  }

  /** Active session emulator (used by `/screenshot`, `/goal`, text-command listener). */
  getActiveRuntime(): ActiveSessionRuntime | null {
    return this.active;
  }

  async onSessionStart(session: Session<SelfbotPooledUserbot>): Promise<void> {
    if (this.active !== null) {
      throw new Error("PokemonGameDriver.onSessionStart called while active");
    }
    const botClient = this.botClient;
    if (botClient === null) {
      throw new Error(
        "PokemonGameDriver.onSessionStart called before setBotClient",
      );
    }
    const config = this.config;
    // Absolute, so the flash save (resolved against the process cwd) and the goal
    // files (resolved against goal.runtime_directory) always land in this guild's
    // directory regardless of either setting.
    const sessionDir = path.resolve(session.sessionDir);
    const savePath = path.join(sessionDir, POKEMON_SAVE_FILE);
    const goalStatePath = path.join(sessionDir, POKEMON_GOAL_STATE_FILE);
    const goalScreenshotDir = path.join(sessionDir, "goal-screenshots");
    const goalMemoryDir = path.join(sessionDir, POKEMON_GOAL_MEMORY_DIR);

    const emulator = this.factories.createEmulator({
      wasmPath: config.game.wasm_path,
      savePath,
    });
    // Everything booted so far is torn down (and the save flushed) if a later
    // step fails, so a failed /play never leaves an emulator autosaving or a
    // control server holding its port.
    const parts: SessionParts = { emulator };
    try {
      await emulator.init();
      emulator.start();
      logger.info("emulator running", { guildId: session.guildId });

      const streamer = this.factories.createStreamer({
        selfbotClient: session.userbotEntry.userbot.client,
        guildId: session.guildId,
        channelId: session.voiceChannelId,
        canvasHeight: config.stream.video.canvas_height,
        frameRate: config.stream.video.frame_rate,
        bitrateKbps: config.stream.video.bitrate_kbps,
        bitrateMaxKbps: config.stream.video.bitrate_max_kbps,
        hardwareAcceleration:
          Bun.env["STREAM_HARDWARE_ACCELERATION"] === "true" ||
          config.stream.video.hardware_acceleration,
        vaapiDevice:
          Bun.env["VAAPI_DEVICE"] ?? config.stream.video.vaapi_device,
      });
      parts.streamer = streamer;
      await streamer.login();
      emulator.onFrame((frame) => {
        streamer.pushFrame(frame);
      });
      emulator.onAudio(({ pcm }) => {
        streamer.pushAudio(pcm);
      });
      await streamer.start();

      const sendMessage = async (
        message: GoalDiscordMessage,
      ): Promise<void> => {
        const channel = await botClient.channels.fetch(message.channelId);
        if (channel?.isSendable() !== true) {
          throw new Error(
            `Discord channel is not sendable: ${message.channelId}`,
          );
        }
        await channel.send({
          content: message.content,
          allowedMentions: {
            users: message.allowedUserIds ?? [],
            roles: [],
            parse: [],
          },
        });
      };

      let goalManager: GoalManager | undefined;
      let goalControlServer: GoalControlServer | undefined;
      if (this.goalEnabledForGuild(session.guildId)) {
        const goalConfig = {
          ...config.game.goal,
          state_path: goalStatePath,
          screenshot_dir: goalScreenshotDir,
          memory_dir: goalMemoryDir,
        };
        const controlToken = crypto.randomUUID();
        goalManager = new GoalManager({
          config: goalConfig,
          controlToken,
          sendMessage,
          snapshotProvider: () =>
            readGameSnapshot(emulator.memoryReader(), emulator.gameSymbols()),
          spatialSnapshotProvider: () =>
            readSpatialSnapshot(
              emulator.memoryReader(),
              emulator.gameSymbols(),
            ),
          acquireInputLease: () => emulator.acquireInputLease("goal"),
          checkpointGame: () => emulator.checkpointSave(),
        });
        parts.goalManager = goalManager;
        await goalManager.initialize();
        goalControlServer = startGoalControlServer({
          emulator,
          goalManager,
          config: { ...config, game: { ...config.game, goal: goalConfig } },
          token: controlToken,
        });
        parts.goalControlServer = goalControlServer;
      }

      if (
        config.bot.notifications.enabled &&
        config.bot.notifications.events.enabled
      ) {
        const eventsConfig = config.bot.notifications.events;
        try {
          const watcher = createGameEventWatcher({
            reader: emulator.memoryReader(),
            symbols: emulator.gameSymbols(),
          });
          const toggles: EventToggles = {
            faint: eventsConfig.faint,
            whiteout: eventsConfig.whiteout,
            badge: eventsConfig.badge,
            evolution: eventsConfig.evolution,
            catch: eventsConfig.catch,
            levelUp: eventsConfig.level_up,
            dexEntry: eventsConfig.dex_entry,
          };
          const notifier = createEventNotifier({
            client: botClient,
            channelId: session.textChannelId,
            toggles,
            mode: eventsConfig.mode,
            attachScreenshot: eventsConfig.attach_screenshot,
            renderScreenshot: () => encodePng(emulator.renderFrame(), 3),
          });
          const interval = eventsConfig.poll_interval_frames;
          emulator.addFrameHook((frame) => {
            if (frame % interval !== 0) return;
            for (const event of watcher.poll()) {
              notifier.enqueue(event);
            }
          });
          logger.info("game event notifications enabled", {
            guildId: session.guildId,
          });
        } catch (error) {
          logger.error("failed to start game event notifications", error);
        }
      }

      const commandConfig = config.game.commands;
      const timing: CommandTiming = {
        pressFrames: framesFromMs(
          commandConfig.key_press_duration_in_milliseconds,
        ),
        holdFrames: framesFromMs(commandConfig.hold.duration_in_milliseconds),
        burstHoldFrames: framesFromMs(
          commandConfig.burst.duration_in_milliseconds,
        ),
        burstGapFrames: framesFromMs(commandConfig.burst.delay_in_milliseconds),
        burstQuantity: commandConfig.burst.quantity,
      };

      this.active = {
        session,
        emulator,
        streamer,
        ...(goalManager === undefined ? {} : { goalManager }),
        ...(goalControlServer === undefined ? {} : { goalControlServer }),
        timing,
      };
    } catch (error) {
      await this.teardown(parts, session).catch((teardownError: unknown) => {
        logger.error(
          "teardown after failed session start failed",
          teardownError,
        );
      });
      throw error;
    }
  }

  async onSessionStop(
    session: Session<SelfbotPooledUserbot>,
    reason: SessionStopReason,
  ): Promise<void> {
    logger.info("pokemon driver stop", {
      guildId: session.guildId,
      reason,
    });
    const runtime = this.active;
    this.active = null;
    if (runtime === null) {
      return;
    }
    await this.teardown(runtime, session);
  }

  /**
   * Stop every booted part, then commit and durably flush the save. Throws if the
   * final flush fails so `/stop` never reports a save that was not written.
   */
  private async teardown(
    parts: SessionParts,
    session: Session<SelfbotPooledUserbot>,
  ): Promise<void> {
    try {
      await parts.goalManager?.shutdown();
    } catch (error) {
      logger.error("goalManager shutdown failed", error);
    }
    if (parts.goalControlServer !== undefined) {
      try {
        await parts.goalControlServer.stop(true);
      } catch (error) {
        logger.error("goalControlServer stop failed", error);
      }
    }
    if (parts.streamer !== undefined) {
      try {
        await parts.streamer.stop();
      } catch (error) {
        logger.error("streamer stop failed", error);
      }
      try {
        parts.streamer.destroy();
      } catch (error) {
        logger.error("streamer destroy failed", error);
      }
    }
    // Commit live progress to the flash save before halting, so a goal-driven
    // session resumes where it left off instead of the last in-game save. Only
    // when goal mode is active (per the "goals save at the end" requirement).
    // Retries a transient non-saveable state and surfaces a persistent failure
    // rather than swallowing it (shared with the goal-end path). The emulator
    // loop is still running here, so a cutscene/animation can clear between
    // attempts; it is halted just below.
    if (parts.goalManager !== undefined) {
      await checkpointWithRetry(
        () => parts.emulator.checkpointSave(),
        `session stop (guild ${session.guildId})`,
      );
    }
    // Halt the loop and wait for the final flash write to be durable before the
    // session ends, so the next /play (this guild or another) never races it.
    await parts.emulator.stopAndFlush();
  }

  welcomeMessage(session: Session<SelfbotPooledUserbot>): string {
    return `Starting Pokémon in <#${session.voiceChannelId}>. Visit https://pokemon.sjer.red/?g=${session.guildId} to watch.`;
  }
}

type SessionParts = {
  readonly emulator: Emulator;
  streamer?: SessionStreamer;
  goalManager?: GoalManager;
  goalControlServer?: GoalControlServer;
};

export type ActiveSessionRuntime = {
  readonly session: Session<SelfbotPooledUserbot>;
  readonly emulator: Emulator;
  readonly streamer: SessionStreamer;
  readonly goalManager?: GoalManager;
  readonly goalControlServer?: GoalControlServer;
  readonly timing: CommandTiming;
};
