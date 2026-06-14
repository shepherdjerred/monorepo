import * as Sentry from "@sentry/bun";

Sentry.init({
  dsn:
    Bun.env.SENTRY_DSN ??
    "https://9c905c2bb5924e55b4dea32e2a95f0d1@bugsink.sjer.red/8",
  environment: Bun.env.NODE_ENV ?? "development",
  // Don't let Sentry register the global OTel TracerProvider/Propagator/
  // ContextManager. It runs before initializeTracing(), so it lands first and
  // the NodeSDK below fails registration ("duplicate registration of API:
  // trace") — spans then route through Sentry's sampler (tracesSampleRate
  // unset) and never reach Tempo. Sentry stays for errors via captureException.
  skipOpenTelemetrySetup: true,
});

import { initializeTracing } from "./observability/tracing.ts";

// Start OTLP tracing before any traced network work (Discord login, voice).
initializeTracing();

import { match } from "ts-pattern";
import { handleMessages } from "./discord/message-handler.ts";
import { handleSlashCommands } from "./discord/slashCommands/index.ts";
import { registerSlashCommands } from "./discord/slashCommands/rest.ts";
import { handleChannelUpdate } from "./discord/channel-handler.ts";
import { parseCommandInput } from "./game/command/command-input.ts";
import type { CommandInput } from "./game/command/command-input.ts";
import { createWebServer } from "./webserver/index.ts";
import { logger } from "./logger.ts";
import { getConfig } from "./config/index.ts";
import { Emulator } from "./emulator/emulator.ts";
import { enqueueCommand, framesFromMs } from "./emulator/command-sink.ts";
import type { CommandTiming } from "./emulator/command-sink.ts";
import { encodePng } from "./emulator/png.ts";
import { GameStreamer } from "./stream/game-streamer.ts";
import discordClient from "./discord/client.ts";
import { createGameEventWatcher } from "./game/events/watcher.ts";
import { readGameSnapshot } from "./game/events/snapshot.ts";
import { createEventNotifier } from "./discord/event-notifier.ts";
import type { EventToggles } from "./discord/event-notifier.ts";
import { GoalManager, type GoalDiscordMessage } from "./goal/goal-manager.ts";
import {
  startGoalControlServer,
  type GoalControlServer,
} from "./goal/control-server.ts";
import type {
  LoginResponse,
  StatusResponse,
  ScreenshotResponse,
} from "@discord-plays-pokemon/common";

const config = getConfig();

const commandConfig = config.game.commands;
const timing: CommandTiming = {
  pressFrames: framesFromMs(commandConfig.key_press_duration_in_milliseconds),
  holdFrames: framesFromMs(commandConfig.hold.duration_in_milliseconds),
  burstHoldFrames: framesFromMs(commandConfig.burst.duration_in_milliseconds),
  burstGapFrames: framesFromMs(commandConfig.burst.delay_in_milliseconds),
  burstQuantity: commandConfig.burst.quantity,
};

// ---- emulator ----
let emulator: Emulator | undefined;
if (config.game.enabled) {
  emulator = new Emulator({
    wasmPath: config.game.wasm_path,
    savePath: config.game.save_path,
  });
  await emulator.init();
  emulator.start();
  logger.info("emulator running");
}

// ---- stream ----
let streamer: GameStreamer | undefined;
if (config.stream.enabled) {
  streamer = new GameStreamer({
    token: config.stream.userbot.token,
    guildId: config.server_id,
    channelId: config.stream.channel_id,
    canvasHeight: config.stream.video.canvas_height,
    frameRate: config.stream.video.frame_rate,
    bitrateKbps: config.stream.video.bitrate_kbps,
    bitrateMaxKbps: config.stream.video.bitrate_max_kbps,
    // Env (set by the k8s deployment) overrides config so VAAPI can be toggled
    // without editing the 1Password-sourced config.toml.
    hardwareAcceleration:
      Bun.env.STREAM_HARDWARE_ACCELERATION === "true" ||
      config.stream.video.hardware_acceleration,
    vaapiDevice: Bun.env.VAAPI_DEVICE ?? config.stream.video.vaapi_device,
  });
  await streamer.login();

  if (emulator) {
    const activeStreamer = streamer;
    emulator.onFrame((frame) => {
      activeStreamer.pushFrame(frame);
    });
    emulator.onAudio(({ pcm }) => {
      activeStreamer.pushAudio(pcm);
    });
  }

  if (!config.stream.dynamic_streaming) {
    await streamer.start();
  }
}

async function sendDiscordMessage(message: GoalDiscordMessage): Promise<void> {
  const channel = await discordClient.channels.fetch(message.channelId);
  if (channel?.isSendable() !== true) {
    throw new Error(`Discord channel is not sendable: ${message.channelId}`);
  }

  await channel.send({
    content: message.content,
    allowedMentions: {
      users: message.allowedUserIds ?? [],
      roles: [],
      parse: [],
    },
  });
}

// ---- goal mode control loop ----
let goalManager: GoalManager | undefined;
let goalControlServer: GoalControlServer | undefined;
if (emulator && config.game.goal.enabled) {
  const controlToken = crypto.randomUUID();
  goalManager = new GoalManager({
    config: config.game.goal,
    controlToken,
    sendMessage: sendDiscordMessage,
    snapshotProvider: () =>
      readGameSnapshot(emulator.memoryReader(), emulator.gameSymbols()),
  });
  await goalManager.initialize();
  goalControlServer = startGoalControlServer({
    emulator,
    goalManager,
    config,
    token: controlToken,
  });
}

// ---- web server (optional) ----
if (config.web.enabled) {
  const { socket } = createWebServer({
    port: config.web.port,
    webAssetsPath: config.web.assets,
    isApiEnabled: config.web.api.enabled,
    isCorsEnabled: config.web.cors,
  });

  if (socket) {
    socket.subscribe((event) => {
      match(event)
        .with({ request: { kind: "command" } }, (commandEvent) => {
          logger.info("handling command request", commandEvent.request);
          if (emulator === undefined) return;
          try {
            const parsed = parseCommandInput(commandEvent.request.value);
            if (parsed) {
              void enqueueCommand(emulator, parsed, timing);
            } else {
              logger.error("invalid command", commandEvent.request.value);
            }
          } catch (error) {
            logger.error(error);
          }
        })
        .with({ request: { kind: "login" } }, (loginEvent) => {
          logger.info("handling login request", loginEvent.request);
          // TODO: perform auth here
          const player = { discordId: "id", discordUsername: "username" };
          const response: LoginResponse = { kind: "login", value: player };
          loginEvent.socket.emit("response", response);
        })
        .with({ request: { kind: "screenshot" } }, (screenshotEvent) => {
          logger.info("handling screenshot request", screenshotEvent.request);
          if (emulator === undefined) {
            logger.error("emulator is not initialized");
            return;
          }
          const png = encodePng(emulator.renderFrame(), 3);
          const response: ScreenshotResponse = {
            kind: "screenshot",
            value: png.toString("base64"),
          };
          screenshotEvent.socket.emit("response", response);
        })
        .with({ request: { kind: "status" } }, (statusEvent) => {
          logger.info("handling status request", statusEvent.request);
          const response: StatusResponse = {
            kind: "status",
            value: { playerList: [] },
          };
          statusEvent.socket.emit("response", response);
        })
        .exhaustive();
    });
  }
}

// ---- discord slash commands ----
if (emulator && config.bot.enabled && config.bot.commands.enabled) {
  if (config.bot.commands.update) {
    await registerSlashCommands();
  }
  handleSlashCommands(emulator, goalManager);
}

// ---- in-game event notifications ----
// Polls emulator memory each Nth frame and posts detected events (faints,
// badges, evolutions, catches, ...). Built inside a try/catch so a missing wasm
// symbol degrades to "no notifications" rather than taking down the stream.
if (
  emulator &&
  config.bot.enabled &&
  config.bot.notifications.enabled &&
  config.bot.notifications.events.enabled
) {
  const eventsConfig = config.bot.notifications.events;
  try {
    const activeEmulator = emulator;
    const watcher = createGameEventWatcher({
      reader: activeEmulator.memoryReader(),
      symbols: activeEmulator.gameSymbols(),
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
      client: discordClient,
      channelId: config.bot.notifications.channel_id,
      toggles,
      mode: eventsConfig.mode,
      attachScreenshot: eventsConfig.attach_screenshot,
      renderScreenshot: () => encodePng(activeEmulator.renderFrame(), 3),
    });
    const interval = eventsConfig.poll_interval_frames;
    activeEmulator.addFrameHook((frame) => {
      if (frame % interval !== 0) return;
      for (const event of watcher.poll()) {
        notifier.enqueue(event);
      }
    });
    logger.info(
      `game event notifications enabled (mode=${eventsConfig.mode}, every ${String(interval)} frames)`,
    );
  } catch (error) {
    logger.error("failed to start game event notifications", error);
  }
}

// ---- discord text commands ----
if (emulator && config.game.enabled && config.game.commands.enabled) {
  const activeEmulator = emulator;
  logger.info("game and discord commands are enabled");
  handleMessages(async (commandInput: CommandInput): Promise<void> => {
    try {
      await enqueueCommand(activeEmulator, commandInput, timing);
    } catch (error) {
      logger.error(error);
    }
  });
}

// ---- dynamic streaming: start/stop Go-Live with channel occupancy ----
if (streamer && config.stream.dynamic_streaming) {
  const activeStreamer = streamer;
  logger.info("dynamic streaming is enabled");
  handleChannelUpdate(async (participants) => {
    logger.info(`channel update: ${String(participants)} participant(s)`);
    await (participants > 0 ? activeStreamer.start() : activeStreamer.stop());
  });
}

async function shutdown(): Promise<void> {
  await goalManager?.shutdown();
  if (goalControlServer !== undefined) {
    await goalControlServer.stop(true);
  }
  emulator?.stop();
}

async function shutdownAndExit(): Promise<void> {
  await shutdown();
  process.exit(0);
}

process.once("SIGTERM", () => {
  void shutdownAndExit();
});

process.once("SIGINT", () => {
  void shutdownAndExit();
});
