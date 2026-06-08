import * as Sentry from "@sentry/bun";

Sentry.init({
  dsn:
    Bun.env.SENTRY_DSN ??
    "https://9c905c2bb5924e55b4dea32e2a95f0d1@bugsink.sjer.red/8",
  environment: Bun.env.NODE_ENV ?? "development",
});

import { initializeTracing } from "./observability/tracing.ts";

// Start OTLP tracing before any traced network work (Discord login, voice).
initializeTracing();

import { match } from "ts-pattern";
import type { Socket } from "socket.io";
import { handleSlashCommands } from "./discord/slashCommands/index.ts";
import { registerSlashCommands } from "./discord/slashCommands/rest.ts";
import { handleChannelUpdate } from "./discord/channel-handler.ts";
import { createWebServer } from "./webserver/index.ts";
import { logger } from "./logger.ts";
import { getConfig } from "./config/index.ts";
import { N64Emulator } from "./emulator/n64-emulator.ts";
import { encodePng } from "./emulator/png.ts";
import { GameStreamer } from "./stream/game-streamer.ts";
import { SeatManager } from "./input/seat-manager.ts";
import type {
  LoginResponse,
  StatusResponse,
  ScreenshotResponse,
  SeatResponse,
  SeatsResponse,
} from "@discord-plays-mario-kart/common";

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
  });
  await streamer.login();

  if (emulator) {
    const activeStreamer = streamer;
    emulator.onFrame((frame) => {
      activeStreamer.pushFrame(frame);
    });
  }

  if (!config.stream.dynamic_streaming) {
    await streamer.start();
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

  const broadcastSeats = (sock: Socket): void => {
    const response: SeatsResponse = {
      kind: "seats",
      value: { occupied: seatManager.occupied() },
    };
    sock.nsp.emit("response", response);
  };

  if (socket) {
    socket.subscribe((event) => {
      const sock = event.socket;
      match(event)
        .with({ request: { kind: "seat-claim" } }, (e) => {
          const seat = seatManager.claim(sock.id, e.request.seat);
          const response: SeatResponse = { kind: "seat", value: { seat } };
          sock.emit("response", response);
          if (seat !== null) {
            // Free the seat (and clear held input) when this socket leaves.
            sock.once("disconnect", () => {
              const freed = seatManager.release(sock.id);
              if (freed !== null) {
                emulator?.clearPlayerInput(freed);
                broadcastSeats(sock);
              }
            });
            broadcastSeats(sock);
          }
        })
        .with({ request: { kind: "seat-release" } }, () => {
          const freed = seatManager.release(sock.id);
          if (freed !== null) emulator?.clearPlayerInput(freed);
          const response: SeatResponse = {
            kind: "seat",
            value: { seat: null },
          };
          sock.emit("response", response);
          broadcastSeats(sock);
        })
        .with({ request: { kind: "input" } }, (e) => {
          if (emulator === undefined) return;
          if (!seatManager.owns(sock.id, e.request.seat)) return; // not your seat
          emulator.setPlayerInput(e.request.seat, e.request.state);
        })
        .with({ request: { kind: "login" } }, (e) => {
          // TODO: real auth. Identity is cosmetic; seats gate control.
          const player = { discordId: "id", discordUsername: "username" };
          const response: LoginResponse = { kind: "login", value: player };
          e.socket.emit("response", response);
        })
        .with({ request: { kind: "screenshot" } }, (e) => {
          if (emulator === undefined) return;
          const frame = emulator.renderFrame();
          if (frame.height === 0) return;
          const png = encodePng(frame.rgba, frame.width, frame.height, 2);
          const response: ScreenshotResponse = {
            kind: "screenshot",
            value: png.toString("base64"),
          };
          e.socket.emit("response", response);
        })
        .with({ request: { kind: "status" } }, (e) => {
          const response: StatusResponse = {
            kind: "status",
            value: { playerList: [] },
          };
          e.socket.emit("response", response);
          broadcastSeats(e.socket);
        })
        .exhaustive();
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
