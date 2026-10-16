import { games, type GameId } from "@arcade/common/catalog.ts";
import type { GameState } from "@arcade/common/telemetry.ts";
import type { SelfbotPooledUserbot } from "@shepherdjerred/discord-stream-lifecycle/pool/selfbot-client";
import { GameStreamer } from "@discord-plays-mario-kart/backend/stream/game-streamer.ts";
import type { RuntimeConfig as Config } from "@discord-plays-mario-kart/backend/config/schema.ts";
import { encodePng } from "@shepherdjerred/discord-plays-core/image/png.ts";
import type { MediaFeeds } from "#src/media/feeds.ts";
import type { StatsStore } from "#src/stats/store.ts";
import { ResultTracker } from "#src/stats/tracker.ts";
import type { RuntimeCallbacks } from "#src/runtime/media-peer.ts";
import type { RuntimeHost } from "#src/runtime/host.ts";
import { waitFor } from "#src/runtime/wait.ts";
import { NativeMediaClock } from "#src/media/clock.ts";
import { UserError } from "#src/errors.ts";
import type { GameServerModule } from "./module.ts";
import { nativeFormats, type NativeGameId } from "./formats.ts";

export function nativeModule(options: {
  gameId: NativeGameId;
  config: Config;
  feeds: MediaFeeds;
  stats: StatsStore;
  startupTimeoutMs: number;
  decode: () => (data: unknown) => GameState;
  host: (sessionDir: string, callbacks: RuntimeCallbacks) => RuntimeHost;
  statsChanged: (guildId: string, gameId: GameId) => void;
}): GameServerModule<SelfbotPooledUserbot> {
  return {
    definition: games[options.gameId],
    saveEntries:
      options.gameId === "brawl"
        ? ["emulator/Wii", "emulator/GC"]
        : ["profile/Default/IndexedDB"],
    create(context) {
      const format = nativeFormats[options.gameId];
      const feed = options.feeds.create(
        context.session.id,
        format,
        options.config,
      );
      const ready = Promise.withResolvers<undefined>();
      const decode = options.decode();
      let closing = false;
      let frame: Buffer | undefined;
      let lastPublished = -Infinity;
      let lastPhase: string | undefined;
      let lastRound: number | undefined;
      const tracker = new ResultTracker({
        gameId: options.gameId,
        guildId: context.session.guildId,
        sessionId: context.session.id,
        players: context.players,
        store: options.stats,
        recorded: () => {
          options.statsChanged(context.session.guildId, options.gameId);
        },
        failed: context.reportError,
      });
      const video = options.config.stream.video;
      const streamer = new GameStreamer({
        selfbotClient: context.session.userbotEntry.userbot.client,
        guildId: context.session.guildId,
        channelId: context.session.voiceChannelId,
        format: { ...format, rowScale: 1 },
        pixelFormat: format.pixelFormat,
        displayAspect: format.displayAspect,
        canvasHeight: video.canvas_height,
        frameRate: 30,
        bitrateKbps: video.bitrate_kbps,
        bitrateMaxKbps: video.bitrate_max_kbps,
        hardwareAcceleration: video.hardware_acceleration,
        vaapiDevice: video.vaapi_device,
        encoderAsyncDepth: video.encoder_async_depth,
        lowLatencyMux: video.low_latency_mux,
        lowDelayAudio: video.low_delay_audio,
        videoPlayoutDelayMaxMs: video.video_playout_delay_max_ms,
        onEncoderStarted: () => {
          feed.service.startSession();
          ready.resolve(undefined);
        },
        onMediaOverrun: () => {
          context.fatalError(
            new Error("Game audio exceeded its bounded latency window"),
          );
        },
        onSessionEnded: () => {
          if (!closing)
            context.fatalError(
              new Error("Discord game broadcast ended unexpectedly"),
            );
        },
      });
      const clock = new NativeMediaClock({
        frame: (bytes, timeMs) => {
          if (closing) return;
          frame = bytes;
          streamer.pushFrame(bytes, { contentTimeMs: timeMs });
          feed.service.pushFrame(bytes);
        },
        audio: (bytes, timeMs) => {
          if (closing) return;
          streamer.pushAudio(bytes, timeMs);
          feed.service.pushAudio(bytes);
        },
      });
      const host = options.host(context.session.sessionDir, {
        frame: (bytes, timeMs) => {
          clock.video(bytes, timeMs);
        },
        audio: (bytes, timeMs) => {
          clock.audio(bytes, timeMs);
        },
        telemetry: (data) => {
          if (closing) return;
          const state = decode(data);
          tracker.update(state);
          const now = performance.now();
          if (state.family === "pokemon")
            throw new Error("Native adapter returned Pokémon telemetry");
          if (
            now - lastPublished >= 200 ||
            lastPhase !== state.phase ||
            lastRound !== state.round
          ) {
            lastPublished = now;
            lastPhase = state.phase;
            lastRound = state.round;
            context.publishState(state);
          }
        },
        fatal: (error) => {
          if (!closing) context.fatalError(error);
        },
      });
      return {
        async start(signal) {
          await streamer.start();
          await waitFor(
            ready.promise,
            signal,
            options.startupTimeoutMs,
            "Discord broadcast startup",
          );
          await host.start(signal);
        },
        async stop() {
          closing = true;
          const failures: unknown[] = [];
          for (const work of [
            () => host.stop(),
            () => tracker.flush(),
            () => streamer.shutdown(),
          ])
            try {
              await work();
            } catch (error) {
              failures.push(error);
            }
          feed.close();
          frame = undefined;
          if (failures.length > 0)
            throw new AggregateError(
              failures,
              "Game did not stop and save cleanly",
            );
        },
        input: (seat, state) => {
          host.input(seat, state);
        },
        clearInput: (seat) => {
          host.clearInput(seat);
        },
        screenshot: () => {
          if (frame === undefined)
            throw new UserError(
              409,
              "The game has not produced a picture yet.",
            );
          return Promise.resolve(
            encodePng(frame, format.width, format.height, 1),
          );
        },
      };
    },
  };
}
