import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createActor, waitFor, type Actor } from "xstate";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import { createPlaybackMachine } from "@shepherdjerred/streambot/machine/playback-machine.ts";
import type { PlaybackInput } from "@shepherdjerred/streambot/machine/types.ts";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import { resolveSource } from "@shepherdjerred/streambot/sources/resolve.ts";
import {
  expandPlaylist,
  listExtractors,
} from "@shepherdjerred/streambot/sources/ytdlp.ts";
import { StreambotStreamer } from "@shepherdjerred/streambot/streamer/streamer.ts";
import { CommandBot } from "@shepherdjerred/streambot/discord/command-bot.ts";
import { SessionManager } from "@shepherdjerred/streambot/session/session-manager.ts";
import {
  loadState,
  saveState,
  stateFilePath,
} from "@shepherdjerred/streambot/state/persistence.ts";
import {
  buildResumeInput,
  buildSnapshot,
  resumeKeyFor,
} from "@shepherdjerred/streambot/state/resume.ts";
import {
  ChannelIdSchema,
  GuildIdSchema,
  UserIdSchema,
  type GuildId,
  type ChannelId,
} from "@shepherdjerred/streambot/types/ids.ts";
import { getErrorMessage } from "@shepherdjerred/streambot/util/errors.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";
import { register } from "@shepherdjerred/streambot/observability/metrics.ts";

/**
 * End-to-end test, run manually with real credentials (`bun run e2e`; formerly the `e2eStreambot`
 * Dagger function, removed 2026-07 with the CI pipeline). Exercises BOTH
 * Discord identities — the command bot (logs in, registers slash commands on the guild) and the
 * userbot streamer (joins the voice channel and streams).
 *
 * Two phases:
 *  1. Generate a clip, drive it into the voice channel, assert `streaming`, then stop cleanly.
 *  2. Resume: play, capture the position, persist it, tear the session down (simulated restart), then
 *     boot a fresh session from the persisted state and assert it resumes near the same position and
 *     keeps playing. Exits non-zero on failure.
 */
const log = logger.child("e2e");
const TEST_CLIP = "/tmp/streambot-e2e.mp4";
// Sidecar next to the clip (same base name) so subtitles (on by default) burn in over the live stream.
const TEST_SIDECAR = "/tmp/streambot-e2e.en.srt";
const REQUESTER = UserIdSchema.parse("100000000000000001");
const STREAM_HOLD_MS = 6000;
const CLIP_DURATION_SECONDS = 30;
/** Resume tolerance — wall-clock position can drift a little vs the captured checkpoint. */
const RESUME_TOLERANCE_SECONDS = 5;

async function generateClip(ffmpegPath: string): Promise<void> {
  const proc = Bun.spawn(
    [
      ffmpegPath,
      "-y",
      "-f",
      "lavfi",
      "-i",
      `testsrc=duration=${String(CLIP_DURATION_SECONDS)}:size=1280x720:rate=30`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=440:duration=${String(CLIP_DURATION_SECONDS)}`,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-c:a",
      "aac",
      "-shortest",
      TEST_CLIP,
    ],
    { stdout: "pipe", stderr: "pipe", stdin: "ignore" },
  );
  const [stderr, code] = await Promise.all([
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(
      `ffmpeg test-clip generation failed (code ${String(code)}): ${stderr.trim()}`,
    );
  }
}

type Session = {
  streamer: StreambotStreamer;
  actor: Actor<ReturnType<typeof createPlaybackMachine>>;
  commandBot: CommandBot;
};

/** Build a real session (streamer + machine + command bot) with the given start input. */
function buildSession(config: Config, input: PlaybackInput): Session {
  const userToken = config.discord.userTokens[0];
  if (userToken === undefined) {
    throw new Error("e2e requires at least one user token (USER_TOKENS/TOKEN)");
  }
  const streamer = new StreambotStreamer(userToken, config);
  const actor = createActor(
    createPlaybackMachine({
      joinVoice: streamer.joinVoice,
      resolveSource: (actorInput, signal) =>
        resolveSource(config, actorInput.source, signal),
      runStream: streamer.runStream,
      leaveVoice: streamer.leaveVoice,
    }),
    { input },
  );

  // The command bot just proves the bot token logs in + registers; the test drives the actor
  // directly. Its session manager is wired to an empty pool so no extra userbot is acquired.
  const refs: { sessions: SessionManager | null } = { sessions: null };
  const commandBot = new CommandBot({
    config,
    getSessions: () => {
      if (refs.sessions === null) {
        throw new Error("session manager not initialized");
      }
      return refs.sessions;
    },
    library: () => [],
    expandPlaylist: (url, signal) => expandPlaylist(config, url, signal),
    listSources: (signal) => listExtractors(config, signal),
    resolvePlaySource: (source, signal) =>
      resolveSource(config, source, signal),
  });
  refs.sessions = new SessionManager({
    config,
    pool: {
      acquire: () => null,
      release: () => {
        /* empty pool: nothing to release */
      },
      canServe: () => false,
    },
    resolveSource: (actorInput, signal) =>
      resolveSource(config, actorInput.source, signal),
    announce: (channelId, message) => commandBot.announce(channelId, message),
  });

  return { streamer, actor, commandBot };
}

async function startSession(session: Session): Promise<void> {
  // Log in BEFORE starting the machine: on the resume session the queue is non-empty, so the
  // machine immediately tries to joinVoice, which needs the streamer connected (mirrors index.ts).
  await Promise.all([session.streamer.login(), session.commandBot.login()]);
  await session.commandBot.ready;
  session.actor.start();
}

async function stopSession(session: Session): Promise<void> {
  session.actor.stop();
  await session.commandBot.destroy();
  await session.streamer.destroy();
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait until the streamer has anchored its playback clock (`getPosition()` becomes non-null after
 * `player.start()` resolves). The machine reaches `streaming` the instant the runStream actor is
 * invoked — a tick before the clock is anchored — so reading the position immediately would race and
 * report 0. Polling here lets us assert the true resume offset without masking a real seek bug (a
 * broken seek would still surface as ~0).
 */
async function waitForPosition(
  streamer: StreambotStreamer,
  timeoutMs = 10_000,
): Promise<number> {
  const start = Date.now();
  for (;;) {
    const position = streamer.getPosition();
    if (position !== null) {
      return position;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error("streamer never anchored a playback position");
    }
    await sleep(50);
  }
}

/**
 * Assert the observability metrics reflect an in-progress real stream. Throws with the relevant
 * `streambot_*` lines on failure. The send-frametime histogram is the load-bearing check — it only
 * advances when frames are actually packetized and sent over the Discord voice connection.
 */
function assertStreamingMetrics(metricsText: string): void {
  const dump = (): string =>
    metricsText
      .split("\n")
      .filter(
        (l) =>
          l.startsWith("streambot_send_") ||
          l.startsWith("streambot_stream_") ||
          l.startsWith("streambot_source_info"),
      )
      .join("\n");

  // prom-client emits the default `app="streambot"` label alongside `kind`, in registration order,
  // so match `kind="video"` anywhere within the label set rather than assuming label order.
  const videoSends =
    /streambot_send_frametime_ratio_count\{[^}]*kind="video"[^}]*\}\s+(\d+)/.exec(
      metricsText,
    );
  if (videoSends === null || Number(videoSends[1]) <= 0) {
    throw new Error(
      `expected streambot_send_frametime_ratio observations for video frames, got none:\n${dump()}`,
    );
  }
  if (!/streambot_stream_active\{[^}]*\}\s+1\b/.test(metricsText)) {
    throw new Error(
      `expected streambot_stream_active=1 during streaming:\n${dump()}`,
    );
  }
  if (!/streambot_source_info\{[^}]*\}\s+1\b/.test(metricsText)) {
    throw new Error(`expected streambot_source_info to be set:\n${dump()}`);
  }
  log.info("e2e: observability metrics PASS", {
    videoSends: videoSends[1],
  });
}

async function main(): Promise<number> {
  const baseConfig = loadConfig();
  await generateClip(baseConfig.ffmpegPath);
  // Sidecar next to the clip (same base name) so subtitles (on by default) burn in over the live
  // stream — exercises the real resolve → software-encode → burn path end to end.
  await Bun.write(
    TEST_SIDECAR,
    "1\n00:00:00,000 --> 00:00:11,000\nstreambot e2e subtitle\n",
  );

  // The voice channel is pinned via test-only env (the bot otherwise joins the requester's current
  // VC, which an unattended e2e has no way to set).
  const guildId: GuildId = GuildIdSchema.parse(Bun.env["E2E_GUILD_ID"]);
  const channelId: ChannelId = ChannelIdSchema.parse(
    Bun.env["E2E_VIDEO_CHANNEL_ID"],
  );

  const stateDir = await mkdtemp(path.join(tmpdir(), "streambot-e2e-state-"));
  const config: Config = {
    ...baseConfig,
    state: { dir: stateDir, resumeMaxAgeSeconds: 3600 },
  };
  const stateFile = stateFilePath(stateDir, guildId, channelId);
  const input: PlaybackInput = {
    guildId,
    channelId,
    idleTimeoutMs: 5000,
  };

  try {
    // --- Phase 1: play, capture position, persist, tear down (simulated restart). ---
    let capturedPosition = 0;
    const s1 = buildSession(config, input);
    try {
      await startSession(s1);
      log.info("e2e: cycle 1 — clients up");
      s1.actor.send({
        type: "ADD",
        source: { kind: "file", path: TEST_CLIP, title: "e2e-test" },
        requesterId: REQUESTER,
      });
      await waitFor(s1.actor, (snapshot) => snapshot.matches("streaming"), {
        timeout: 60_000,
      });
      log.info("e2e: cycle 1 reached streaming");
      await sleep(STREAM_HOLD_MS);

      capturedPosition = s1.streamer.getPosition() ?? 0;
      log.info("e2e: cycle 1 position", { capturedPosition });
      if (capturedPosition < 3) {
        throw new Error(
          `expected playback to advance past 3s, got ${String(capturedPosition)}`,
        );
      }

      // Observability: after several seconds of REAL streaming to the voice channel, the metrics
      // populated by the new StreamObserver must reflect it. This is the one path the credential-free
      // `e2e/local.ts` cannot reach — the Discord send loop (`onSendStats`).
      assertStreamingMetrics(await register.metrics());
      const { context } = s1.actor.getSnapshot();
      await saveState(
        stateFile,
        buildSnapshot({
          context,
          positionSeconds: capturedPosition,
          savedAt: Date.now(),
          resumeKey:
            context.current === null
              ? null
              : resumeKeyFor(context.current.source),
          resumeAttempts: 0,
          statusChannelId: null,
        }),
      );
      log.info("e2e: persisted resume state");
    } finally {
      await stopSession(s1);
    }

    // --- Phase 2: boot a fresh session from disk; assert it resumes and keeps playing. ---
    const restored = await loadState(
      stateFile,
      config.state.resumeMaxAgeSeconds,
    );
    if (restored === null) {
      log.error("e2e: resume state failed to load");
      return 1;
    }
    const decision = buildResumeInput(restored, input, {
      maxResumeAttempts: 3,
    });
    if (!decision.resumedCurrent) {
      log.error("e2e: resume decision did not resume the in-progress item");
      return 1;
    }

    const s2 = buildSession(config, decision.input);
    try {
      await startSession(s2);
      log.info("e2e: cycle 2 — clients up, resuming");
      await waitFor(s2.actor, (snapshot) => snapshot.matches("streaming"), {
        timeout: 60_000,
      });
      // Wait for the clock to anchor (player.start resolved) before reading the resume offset, so we
      // assert the real seek position rather than racing the streamer's setup.
      const resumedAt = await waitForPosition(s2.streamer);
      log.info("e2e: cycle 2 resumed position", {
        resumedAt,
        capturedPosition,
      });
      if (Math.abs(resumedAt - capturedPosition) > RESUME_TOLERANCE_SECONDS) {
        throw new Error(
          `resume seek off: resumed at ${String(resumedAt)} vs captured ${String(capturedPosition)}`,
        );
      }
      await sleep(2000);
      const advanced = s2.streamer.getPosition() ?? 0;
      if (advanced <= resumedAt) {
        throw new Error(
          `playback did not advance after resume: ${String(advanced)} <= ${String(resumedAt)}`,
        );
      }

      s2.actor.send({ type: "STOP" });
      await waitFor(s2.actor, (snapshot) => snapshot.matches("idle"), {
        timeout: 30_000,
      });
      log.info("e2e: resume PASS");
      return 0;
    } finally {
      await stopSession(s2);
    }
  } catch (error) {
    log.error("e2e failed", { error: getErrorMessage(error) });
    return 1;
  } finally {
    try {
      await rm(stateDir, { recursive: true });
    } catch (error) {
      log.warn("e2e: failed to clean up state dir", {
        error: getErrorMessage(error),
      });
    }
  }
}

const code = await main();
process.exit(code);
