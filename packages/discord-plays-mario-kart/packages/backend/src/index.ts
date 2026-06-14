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

import { handleSlashCommands } from "./discord/slashCommands/index.ts";
import { registerSlashCommands } from "./discord/slashCommands/rest.ts";
import { handleChannelUpdate } from "./discord/channel-handler.ts";
import { createWebServer } from "./webserver/index.ts";
import { handleRequest } from "./webserver/dispatch.ts";
import type { LeaderboardDeps } from "./webserver/dispatch.ts";
import { logger } from "./logger.ts";
import { getConfig } from "./config/index.ts";
import { N64Emulator } from "./emulator/n64-emulator.ts";
import { WIDTH } from "./emulator/constants.ts";
import type { ScreenMode } from "./emulator/mk64-memory.ts";
import { GameStreamer } from "./stream/game-streamer.ts";
import { drawHudOverlay } from "./stream/overlay.ts";
import { SeatManager } from "./input/seat-manager.ts";
import { createPrisma, databaseUrl } from "./database/index.ts";
import { createPrismaLeaderboardStore } from "./leaderboard/store.ts";
import type { LeaderboardStore } from "./leaderboard/store.ts";
import { RaceTracker } from "./leaderboard/race-tracker.ts";
import { NameOverlay } from "./overlay/name-overlay.ts";
import { createLabelRenderer } from "./overlay/label-renderer.ts";
import type { LeaderboardResponse } from "@discord-plays-mario-kart/common";

/** Screen mode to assume before the first RDRAM read (or when reads fail). */
function fallbackScreenMode(seats: number): ScreenMode {
  if (seats <= 1) return "1p";
  if (seats === 2) return "2p-horizontal";
  return "quad";
}

const config = getConfig();
const seatManager = new SeatManager(config.emulator.seats);

// ---- emulator ----
let emulator: N64Emulator | undefined;
if (config.emulator.enabled) {
  emulator = new N64Emulator({
    wasmDir: config.emulator.wasm_dir,
    romPath: config.emulator.rom_path,
    fps: config.emulator.fps,
    software: config.emulator.software_render,
    seats: config.emulator.seats,
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
    onSessionEnded:
      emulator === undefined
        ? undefined
        : () => {
            // Guard against a WASM trap/panic in reset(): a synchronous throw here
            // propagates through `await onSessionEnded()` in notifyStreamSessionEnded
            // as a rejected promise, which would surface as an unhandled rejection in
            // leaveVoice and leave the XState lifecycle machine stuck. Catch and log
            // instead so the machine can reach its terminal state cleanly.
            try {
              emulator.restartFromStartMenu("stream_session_ended");
            } catch (error) {
              logger.error("emulator reset after stream session failed", error);
              Sentry.captureException(error);
            }
          },
  });
  await streamer.login();

  if (!config.stream.dynamic_streaming) {
    await streamer.start();
  }
}

// ---- leaderboards: race-result capture + name burn-in ----
let leaderboardStore: LeaderboardStore | undefined;
let nameOverlay: NameOverlay | undefined;
let raceTracker: RaceTracker | undefined;
if (config.leaderboard.enabled && emulator) {
  const prisma = createPrisma(databaseUrl(config.leaderboard.db_path));
  leaderboardStore = createPrismaLeaderboardStore(prisma);
  if (config.leaderboard.overlay_enabled) {
    nameOverlay = new NameOverlay(
      createLabelRenderer(config.emulator.wasm_dir),
    );
  }
  logger.info("leaderboards enabled");
}

// ---- compose the per-frame pipeline (overlay → stream → race poll) ----
// `raceTracker` is assigned later (it needs the socket server); the callback
// reads it dynamically each frame, so it picks up the tracker once wired.
if (emulator) {
  const activeEmulator = emulator;
  const activeStreamer = streamer;
  const overlay = nameOverlay;
  activeEmulator.onFrame((frame) => {
    if (activeStreamer !== undefined) {
      // HUD: capture-time wall clock (compare to `date -u` for glass-to-glass
      // latency) + per-seat input echo (press→glass from a recording).
      drawHudOverlay(frame, WIDTH, Date.now(), activeEmulator.seatActivity());
      if (overlay !== undefined) {
        const mode =
          raceTracker?.latestScreenMode() ??
          fallbackScreenMode(config.emulator.seats);
        overlay.apply(
          frame,
          activeEmulator.height,
          mode,
          config.emulator.seats,
        );
      }
      activeStreamer.pushFrame(frame);
    }
    // Always poll for race results, even when not streaming.
    raceTracker?.onFrame();
  });
  // Feed the emulator's resampled PCM to the broadcast. Drained every tick (the
  // sink no-ops until a Go-Live broadcast is active), so registering it here also
  // snaps the audio read cursor to "now" and avoids flushing a startup backlog.
  if (activeStreamer !== undefined) {
    activeEmulator.onAudio((pcm) => {
      activeStreamer.pushAudio(pcm);
    });
  }
}

// ---- web server: the up-to-4 virtual controllers ----
if (config.web.enabled) {
  const { socket } = createWebServer({
    port: config.web.port,
    webAssetsPath: config.web.assets,
    isApiEnabled: config.web.api.enabled,
    isCorsEnabled: config.web.cors,
  });

  // Now that the socket server exists, wire the race tracker so a completed
  // race broadcasts a fresh leaderboard to every connected client.
  let leaderboardDeps: LeaderboardDeps | undefined;
  if (leaderboardStore !== undefined && emulator) {
    const store = leaderboardStore;
    const io = socket?.io;
    const broadcastLeaderboard = async (): Promise<void> => {
      if (io === undefined) return;
      try {
        const entries = await store.leaderboard();
        const response: LeaderboardResponse = {
          kind: "leaderboard",
          value: { entries },
        };
        io.emit("response", response);
      } catch (error) {
        logger.warn("leaderboard broadcast failed", error);
      }
    };
    raceTracker = new RaceTracker({
      emulator,
      seatNames: () => seatManager.names(),
      store,
      pollEveryNFrames: config.leaderboard.poll_every_n_frames,
      onRaceRecorded: () => {
        void broadcastLeaderboard();
      },
    });
    const overlay = nameOverlay;
    leaderboardDeps = {
      store,
      setOverlayName: overlay
        ? (seat, name) => {
            overlay.setName(seat, name);
          }
        : undefined,
    };
  }

  if (socket) {
    socket.events.subscribe((event) => {
      handleRequest(event, {
        seatManager,
        emulator,
        leaderboard: leaderboardDeps,
      });
    });
  }
}

// ---- discord slash commands (optional: /screenshot, /help) ----
if (emulator && config.bot.enabled && config.bot.commands.enabled) {
  if (config.bot.commands.update) {
    await registerSlashCommands();
  }
  handleSlashCommands(emulator);
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
