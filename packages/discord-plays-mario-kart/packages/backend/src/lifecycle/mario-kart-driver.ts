import path from "node:path";
import * as Sentry from "@sentry/bun";
import type { Client as BotClient } from "discord.js";
import type { GameDriver } from "@shepherdjerred/discord-stream-lifecycle/lifecycle/game-driver.ts";
import type {
  Session,
  SessionStopReason,
} from "@shepherdjerred/discord-stream-lifecycle/session/session.ts";
import type { SelfbotPooledUserbot } from "@shepherdjerred/discord-stream-lifecycle/pool/selfbot-client.ts";
import { WorkerEmulator } from "#src/emulator/worker/worker-emulator.ts";
import type { ScreenMode } from "#src/emulator/mk64-memory.ts";
import { GameStreamer } from "#src/stream/game-streamer.ts";
import { applyStreamOverlays } from "#src/overlay/composite.ts";
import type { StreamOverlayContextProvider } from "#src/overlay/composite.ts";
import { SeatManager } from "#src/input/seat-manager.ts";
import { createPrisma, databaseUrl } from "#src/database/index.ts";
import {
  createPrismaLeaderboardStore,
  type LeaderboardStore,
} from "#src/leaderboard/store.ts";
import { RaceTracker } from "#src/leaderboard/race-tracker.ts";
import { NameOverlay } from "#src/overlay/name-overlay.ts";
import { createLabelRenderer } from "#src/overlay/label-renderer.ts";
import type { Config } from "#src/config/schema.ts";
import { logger } from "#src/logger.ts";
import type { LeaderboardResponse } from "@discord-plays-mario-kart/common";

export type ActiveSessionRuntime = {
  readonly session: Session<SelfbotPooledUserbot>;
  readonly emulator: WorkerEmulator;
  readonly streamer: GameStreamer;
  readonly seatManager: SeatManager;
  readonly leaderboardStore: LeaderboardStore;
  readonly raceTracker: RaceTracker;
  readonly nameOverlay: NameOverlay | undefined;
  readonly overlayContext: StreamOverlayContextProvider;
  /** Broadcast a fresh leaderboard via the web socket (no-op when web server is off). */
  setBroadcast: (broadcast: () => Promise<void>) => void;
  /** Get the current broadcast hook (used by RaceTracker callback). */
  getBroadcast: () => () => Promise<void>;
};

function fallbackScreenMode(seats: number): ScreenMode {
  if (seats <= 1) return "1p";
  if (seats === 2) return "2p-horizontal";
  return "quad";
}

/**
 * Per-MK64-session runtime — owns the emulator, streamer, seat manager, leaderboard
 * store, race tracker, and overlay for ONE active game. Creates everything on `/play`,
 * tears it down on `/stop`/auto-leave/idle.
 *
 * Persistence is keyed by `session.sessionDir` (saves/`<guildId>`/) for emulator save
 * data; the leaderboard store is keyed by `session.guildId` so server A's standings
 * never leak into server B's.
 */
export class MarioKartGameDriver implements GameDriver<SelfbotPooledUserbot> {
  readonly name = "Mario Kart 64";
  private readonly config: Config;
  private botClient: BotClient | null = null;
  private active: ActiveSessionRuntime | null = null;

  constructor(params: { config: Config }) {
    this.config = params.config;
  }

  /** Wire the bot client after createGameBot constructs it. Must be called before /play. */
  setBotClient(client: BotClient): void {
    this.botClient = client;
  }

  /** Active session runtime (used by /screenshot and the web dispatcher). */
  getActiveRuntime(): ActiveSessionRuntime | null {
    return this.active;
  }

  async onSessionStart(session: Session<SelfbotPooledUserbot>): Promise<void> {
    if (this.active !== null) {
      throw new Error("MarioKartGameDriver.onSessionStart called while active");
    }
    if (this.botClient === null) {
      throw new Error(
        "MarioKartGameDriver.onSessionStart called before setBotClient",
      );
    }
    const config = this.config;
    const seats = config.emulator.seats;
    const seatManager = new SeatManager(seats);

    // Per-guild emulator save isolation: the emulator snapshots MEMFS into
    // savesDir on stop and rehydrates from it on init. Server A's mempak/EEPROM
    // can never leak into server B's because each lives under its own
    // saves/<guildId>/emulator/ tree.
    //
    // WorkerEmulator runs the N64Emulator on a Worker thread so the synchronous
    // ~12–30ms-per-frame wasm stepping stays OFF this (main) event loop, leaving
    // it free for ffmpeg stdin/stdout, demux, and the Discord RTP send. That is
    // what restores full-rate streaming (see plans/2026-07-26_mk64-emulator-worker-thread.md).
    const savesDir = path.join(session.sessionDir, "emulator");
    const emulator = new WorkerEmulator({
      wasmDir: config.emulator.wasm_dir,
      romPath: config.emulator.rom_path,
      fps: config.emulator.fps,
      software: config.emulator.software_render,
      seats,
      savesDir,
      snapshotEveryNFrames: config.leaderboard.poll_every_n_frames,
    });
    await emulator.init();

    // Leaderboard store: per-guild via the factory.forGuild(guildId) helper.
    const prisma = createPrisma(databaseUrl(config.leaderboard.db_path));
    const leaderboardStore = createPrismaLeaderboardStore(prisma).forGuild(
      session.guildId,
    );

    const nameOverlay = config.leaderboard.overlay_enabled
      ? new NameOverlay(createLabelRenderer(config.emulator.wasm_dir))
      : undefined;

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
      onEncoderStarted: () => {
        emulator.start();
        logger.info("emulator running", { guildId: session.guildId });
      },
      onSessionEnded: () => {
        try {
          emulator.restartFromStartMenu("stream_session_ended");
        } catch (error) {
          logger.error("emulator reset after stream session failed", error);
          Sentry.captureException(error);
        }
      },
    });
    await streamer.login();

    // Broadcast hook is wired later (when the web server attaches); use a swap-able
    // closure so the RaceTracker can pick up the real broadcast once it's set.
    let broadcast: () => Promise<void> = () => Promise.resolve();
    const raceTracker = new RaceTracker({
      seatNames: () => seatManager.names(),
      store: leaderboardStore,
      onRaceRecorded: () => {
        void broadcast();
      },
    });
    // Race snapshots are decoded in the Worker (RDRAM lives there) and posted
    // every snapshotEveryNFrames frames; feed each to the tracker.
    emulator.onSnapshot((snap) => {
      raceTracker.updateFromSnapshot(snap);
    });

    const overlayContext: StreamOverlayContextProvider = () => ({
      epochMs: Date.now(),
      // Seat activity + height come from the most recent frame message (the
      // Worker no longer exposes live getters).
      seatActivity: emulator.latestSeatActivity,
      mode: raceTracker.latestScreenMode() ?? fallbackScreenMode(seats),
      seats,
      nameOverlay,
    });

    // Per-frame pipeline: overlay → stream. Race decoding happens in the Worker.
    emulator.onFrame((frame) => {
      applyStreamOverlays(frame.rgba, frame.height, overlayContext());
      streamer.pushFrame(frame.rgba, {
        contentTimeMs: frame.contentTimeMs,
        ...(frame.inputReceivedAtMs === undefined
          ? {}
          : { inputReceivedAtMs: frame.inputReceivedAtMs }),
      });
    });
    emulator.onAudio((pcm, contentEndMs) => {
      streamer.pushAudio(pcm, contentEndMs);
    });

    await streamer.start();

    this.active = {
      session,
      emulator,
      streamer,
      seatManager,
      leaderboardStore,
      raceTracker,
      nameOverlay,
      overlayContext,
      setBroadcast(b) {
        broadcast = b;
      },
      getBroadcast() {
        return broadcast;
      },
    };
  }

  async onSessionStop(
    session: Session<SelfbotPooledUserbot>,
    reason: SessionStopReason,
  ): Promise<void> {
    logger.info("mario-kart driver stop", {
      guildId: session.guildId,
      reason,
    });
    const runtime = this.active;
    this.active = null;
    if (runtime === null) {
      return;
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
    // Snapshot MEMFS → host BEFORE stopping the emulator: once stop() tears the
    // wasm down the FS facade is unreachable. A failure here is logged but
    // shouldn't block the userbot release; the leaderboard (in Prisma) is
    // already durable.
    try {
      await runtime.emulator.persistSaves();
    } catch (error) {
      logger.error("emulator persistSaves failed", error);
    }
    try {
      await runtime.emulator.stop();
    } catch (error) {
      logger.error("emulator stop failed", error);
    }
  }

  welcomeMessage(session: Session<SelfbotPooledUserbot>): string {
    return `Starting Mario Kart 64 in <#${session.voiceChannelId}>. Open https://mariokart.sjer.red to claim a seat.`;
  }

  /** Helper used by the web dispatcher to build a `LeaderboardResponse`. */
  buildLeaderboardResponse(
    entries: LeaderboardResponse["value"]["entries"],
  ): LeaderboardResponse {
    return { kind: "leaderboard", value: { entries } };
  }
}
