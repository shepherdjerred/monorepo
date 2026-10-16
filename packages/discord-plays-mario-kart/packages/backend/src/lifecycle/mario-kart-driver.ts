import * as Sentry from "@sentry/bun";
import type { Client as BotClient } from "discord.js";
import type { GameDriver } from "@shepherdjerred/discord-stream-lifecycle/lifecycle/game-driver";
import type {
  Session,
  SessionStopReason,
} from "@shepherdjerred/discord-stream-lifecycle/session/session";
import type { SelfbotPooledUserbot } from "@shepherdjerred/discord-stream-lifecycle/pool/selfbot-client";
import type { Mk64Snapshot, ScreenMode } from "#src/emulator/mk64-state.ts";
import type { SeatPlayer } from "#src/leaderboard/race-watcher.ts";
import {
  assertEepromIntact,
  createGameEngine,
  migrateLegacyEeprom,
} from "#src/engine/index.ts";
import type { SpaghettiBuild } from "#src/engine/spaghetti/install.ts";
import type { GameEngine } from "#src/engine/game-engine.ts";
import { GameStreamer } from "#src/stream/game-streamer.ts";
import { applyStreamOverlays } from "#src/overlay/composite.ts";
import type { StreamOverlayContextProvider } from "#src/overlay/composite.ts";
import { SeatManager } from "#src/input/seat-manager.ts";
import type {
  LeaderboardStore,
  LeaderboardStoreFactory,
} from "#src/leaderboard/store.ts";
import { RaceTracker } from "#src/leaderboard/race-tracker.ts";
import { NameOverlay } from "#src/overlay/name-overlay.ts";
import { createLabelRenderer } from "#src/overlay/label-renderer.ts";
import type { DriverFeedService } from "@shepherdjerred/discord-plays-core/driver-feed/service.ts";
import type { RuntimeConfig as Config } from "#src/config/schema.ts";
import { logger } from "#src/logger.ts";

export type ActiveSessionRuntime = {
  readonly session: Session<SelfbotPooledUserbot>;
  readonly emulator: GameEngine;
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
  return seats === 2 ? "2p-horizontal" : "quad";
}

/**
 * Run a session-start step; if it fails, stop the already-booted engine before
 * rethrowing. The session was never published, so onSessionStop cannot reach
 * it, and the native engine's game process would otherwise outlive the failure.
 */
async function startOrStopEngine(
  engine: GameEngine,
  step: () => Promise<void>,
): Promise<void> {
  try {
    await step();
  } catch (error) {
    try {
      await engine.stop();
    } catch (stopError) {
      logger.error(
        "engine stop after a failed session start failed",
        stopError,
      );
    }
    throw error;
  }
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
  /** Undefined when [emulator] enabled = false: sessions are refused. */
  private readonly build: SpaghettiBuild | undefined;
  /** Undefined when [driver_feed] is disabled; every call site is optional-chained. */
  private readonly driverFeed: DriverFeedService | undefined;
  private readonly stats: LeaderboardStoreFactory;
  private botClient: BotClient | null = null;
  private active: ActiveSessionRuntime | null = null;
  private readonly seatPlayers: (() => (SeatPlayer | null)[]) | undefined;
  private readonly onSnapshot: ((snapshot: Mk64Snapshot) => void) | undefined;
  private readonly onRaceRecorded: (() => void) | undefined;

  constructor(params: {
    config: Config;
    build: SpaghettiBuild | undefined;
    driverFeed?: DriverFeedService | undefined;
    /** Race history, shared with the web page's stats. */
    stats: LeaderboardStoreFactory;
    seatPlayers?: () => (SeatPlayer | null)[];
    onSnapshot?: (snapshot: Mk64Snapshot) => void;
    onRaceRecorded?: () => void;
  }) {
    this.config = params.config;
    this.build = params.build;
    this.driverFeed = params.driverFeed;
    this.stats = params.stats;
    this.seatPlayers = params.seatPlayers;
    this.onSnapshot = params.onSnapshot;
    this.onRaceRecorded = params.onRaceRecorded;
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
    const build = this.build;
    if (build === undefined) {
      throw new Error(
        "MarioKartGameDriver.onSessionStart: the emulator is disabled ([emulator] enabled = false)",
      );
    }
    const config = this.config;
    const seats = config.emulator.seats;
    const seatManager = new SeatManager(seats);

    // Per-guild save isolation: the game keeps its saves under
    // saves/<guildId>/spaghettikart, so server A's progress never leaks into
    // server B's.
    if (await migrateLegacyEeprom(session.sessionDir)) {
      logger.info("migrated the wasm-era EEPROM save to the native port", {
        guildId: session.guildId,
      });
    }
    await assertEepromIntact(session.sessionDir);
    const emulator = createGameEngine(config, build, {
      sessionDir: session.sessionDir,
      seats,
    });
    await emulator.init();

    // Leaderboard store: per-guild via the factory.forGuild(guildId) helper.
    const leaderboardStore = this.stats.forGuild(session.guildId);

    const { format } = emulator;
    const nameOverlay = config.leaderboard.overlay_enabled
      ? new NameOverlay(createLabelRenderer(build.labelFont, format.rowScale))
      : undefined;

    const streamer = new GameStreamer({
      selfbotClient: session.userbotEntry.userbot.client,
      guildId: session.guildId,
      channelId: session.voiceChannelId,
      format,
      canvasHeight: config.stream.video.canvas_height,
      frameRate: config.stream.video.frame_rate,
      bitrateKbps: config.stream.video.bitrate_kbps,
      bitrateMaxKbps: config.stream.video.bitrate_max_kbps,
      hardwareAcceleration:
        Bun.env["STREAM_HARDWARE_ACCELERATION"] === "true" ||
        config.stream.video.hardware_acceleration,
      vaapiDevice: Bun.env["VAAPI_DEVICE"] ?? config.stream.video.vaapi_device,
      encoderAsyncDepth: config.stream.video.encoder_async_depth,
      lowLatencyMux: config.stream.video.low_latency_mux,
      lowDelayAudio: config.stream.video.low_delay_audio,
      videoPlayoutDelayMaxMs: config.stream.video.video_playout_delay_max_ms,
      onEncoderStarted: () => {
        emulator.start();
        // The driver feed encodes the same frames the stream does, so it only
        // has work once the emulator is producing them.
        this.driverFeed?.startSession();
        logger.info("emulator running", { guildId: session.guildId });
      },
      onSessionEnded: () => {
        if (this.active === null) return;
        try {
          emulator.restartFromStartMenu("stream_session_ended");
        } catch (error) {
          logger.error("emulator reset after stream session failed", error);
          Sentry.captureException(error);
        }
      },
    });
    await startOrStopEngine(emulator, () => streamer.login());

    // Broadcast hook is wired later (when the web server attaches); use a swap-able
    // closure so the RaceTracker can pick up the real broadcast once it's set.
    let broadcast: () => Promise<void> = () => Promise.resolve();
    const raceTracker = new RaceTracker({
      seatPlayers:
        this.seatPlayers ??
        (() =>
          seatManager
            .users()
            .map((user) =>
              user === null
                ? null
                : { discordId: user.discordId, name: user.name },
            )),
      store: leaderboardStore,
      onRaceRecorded: () => {
        this.onRaceRecorded?.();
        void broadcast();
      },
    });
    // The engine decodes race snapshots from the bridge's state record and
    // delivers one every snapshotEveryNFrames frames; feed each to the tracker.
    emulator.onSnapshot((snap) => {
      raceTracker.updateFromSnapshot(snap);
      this.onSnapshot?.(snap);
    });

    const overlayContext: StreamOverlayContextProvider = () => ({
      epochMs: Date.now(),
      // Seat activity comes from the most recent frame.
      seatActivity: emulator.latestSeatActivity,
      mode: raceTracker.latestScreenMode() ?? fallbackScreenMode(seats),
      seats,
      rowScale: format.rowScale,
      nameOverlay,
    });

    // Per-frame pipeline: overlay → stream → driver feed.
    //
    // The tee sits after the overlay so drivers see byte-identical pixels to the
    // Go-Live stream — including the burned-in HUD clock, which lets the browser
    // measure its own glass-to-glass latency off its own canvas.
    //
    // The frame is the bridge message's own buffer and nothing mutates it
    // after applyStreamOverlays returns, so both sinks can hold the same
    // reference. Go-Live is pushed first: it is the path spectators depend on,
    // and it stays ahead of any fault in the newer one (the engine wraps the
    // onFrame callback so a throw cannot end the game).
    emulator.onFrame((frame) => {
      applyStreamOverlays(
        frame.rgba,
        { width: format.width, height: frame.height },
        overlayContext(),
      );
      streamer.pushFrame(frame.rgba, {
        contentTimeMs: frame.contentTimeMs,
        ...(frame.inputReceivedAtMs === undefined
          ? {}
          : { inputReceivedAtMs: frame.inputReceivedAtMs }),
      });
      this.driverFeed?.pushFrame(frame.rgba, frame.inputReceivedAtMs);
    });
    emulator.onAudio((pcm, contentEndMs) => {
      streamer.pushAudio(pcm, contentEndMs);
      this.driverFeed?.pushAudio(pcm);
    });

    await startOrStopEngine(emulator, () => streamer.start());

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
    // Stop encoding for the browser before the stream teardown: the emulator is
    // about to go away, and a client holding a half-decoded GOP on its canvas
    // after `/stop` would be worse than a disconnect.
    try {
      this.driverFeed?.stopSession();
    } catch (error) {
      logger.error("driver feed stop failed", error);
    }
    if (runtime === null) {
      return;
    }
    const failures: unknown[] = [];
    try {
      await runtime.streamer.shutdown();
    } catch (error) {
      failures.push(error);
      logger.error("streamer shutdown failed", error);
    }
    // No save flush: the game writes default.sav into its home as it saves.
    try {
      await runtime.emulator.stop();
    } catch (error) {
      failures.push(error);
      logger.error("emulator stop failed", error);
    }
    try {
      await runtime.raceTracker.flush();
    } catch (error) {
      failures.push(error);
    }
    if (failures.length > 0)
      throw new AggregateError(failures, "Mario Kart shutdown failed");
  }

  welcomeMessage(session: Session<SelfbotPooledUserbot>): string {
    return `Starting Mario Kart 64 in <#${session.voiceChannelId}>. Open https://mariokart.sjer.red to claim a seat.`;
  }
}
