import path from "node:path";
import type { Client as BotClient } from "discord.js";
import type { GameDriver } from "@shepherdjerred/discord-stream-lifecycle/lifecycle/game-driver.ts";
import type {
  Session,
  SessionStopReason,
} from "@shepherdjerred/discord-stream-lifecycle/session/session.ts";
import type { SelfbotPooledUserbot } from "@shepherdjerred/discord-stream-lifecycle/pool/selfbot-client.ts";
import { Emulator } from "#src/emulator/emulator.ts";
import {
  framesFromMs,
  type CommandTiming,
} from "#src/emulator/command-sink.ts";
import { encodePng } from "#src/emulator/png.ts";
import { GameStreamer } from "#src/stream/game-streamer.ts";
import {
  GoalManager,
  type GoalDiscordMessage,
} from "#src/goal/goal-manager.ts";
import {
  startGoalControlServer,
  type GoalControlServer,
} from "#src/goal/control-server.ts";
import { createGameEventWatcher } from "#src/game/events/watcher.ts";
import { readGameSnapshot } from "#src/game/events/snapshot.ts";
import { readSpatialSnapshot } from "#src/game/spatial/spatial-snapshot.ts";
import {
  createEventNotifier,
  type EventToggles,
} from "#src/discord/event-notifier.ts";
import type { Config } from "#src/config/schema.ts";
import { logger } from "#src/logger.ts";

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
  private botClient: BotClient | null = null;
  /** Per-active-session bag of teardown handles. Null when idle. */
  private active: ActiveSessionRuntime | null = null;

  constructor(params: { config: Config }) {
    this.config = params.config;
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
    const savePath = path.join(session.sessionDir, "pokeemerald.flash");
    const goalStatePath = path.join(session.sessionDir, "goal-state.json");
    const goalScreenshotDir = path.join(session.sessionDir, "goal-screenshots");
    const goalMemoryDir = path.join(session.sessionDir, "goal-memory");

    const emulator = new Emulator({
      wasmPath: config.game.wasm_path,
      savePath,
    });
    await emulator.init();
    emulator.start();
    logger.info("emulator running", { guildId: session.guildId });

    const streamer = new GameStreamer({
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
      vaapiDevice: Bun.env["VAAPI_DEVICE"] ?? config.stream.video.vaapi_device,
    });
    await streamer.login();
    emulator.onFrame((frame) => {
      streamer.pushFrame(frame);
    });
    emulator.onAudio(({ pcm }) => {
      streamer.pushAudio(pcm);
    });
    await streamer.start();

    const sendMessage = async (message: GoalDiscordMessage): Promise<void> => {
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
    if (config.game.goal.enabled) {
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
          readSpatialSnapshot(emulator.memoryReader(), emulator.gameSymbols()),
      });
      await goalManager.initialize();
      goalControlServer = startGoalControlServer({
        emulator,
        goalManager,
        config: { ...config, game: { ...config.game, goal: goalConfig } },
        token: controlToken,
      });
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
    try {
      await runtime.goalManager?.shutdown();
    } catch (error) {
      logger.error("goalManager shutdown failed", error);
    }
    if (runtime.goalControlServer !== undefined) {
      try {
        await runtime.goalControlServer.stop(true);
      } catch (error) {
        logger.error("goalControlServer stop failed", error);
      }
    }
    try {
      await runtime.streamer.stop();
    } catch (error) {
      logger.error("streamer stop failed", error);
    }
    try {
      runtime.streamer.destroy();
    } catch (error) {
      logger.error("streamer destroy failed", error);
    }
    try {
      runtime.emulator.stop();
    } catch (error) {
      logger.error("emulator stop failed", error);
    }
  }

  welcomeMessage(session: Session<SelfbotPooledUserbot>): string {
    return `Starting Pokémon in <#${session.voiceChannelId}>. Visit https://pokemon.sjer.red/?g=${session.guildId} to watch.`;
  }
}

export type ActiveSessionRuntime = {
  readonly session: Session<SelfbotPooledUserbot>;
  readonly emulator: Emulator;
  readonly streamer: GameStreamer;
  readonly goalManager?: GoalManager;
  readonly goalControlServer?: GoalControlServer;
  readonly timing: CommandTiming;
};
