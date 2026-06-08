import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createActor, waitFor, type Actor } from "xstate";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import { createPlaybackMachine } from "@shepherdjerred/streambot/machine/playback-machine.ts";
import type { PlaybackInput } from "@shepherdjerred/streambot/machine/types.ts";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import { resolveSource } from "@shepherdjerred/streambot/sources/resolve.ts";
import { expandPlaylist } from "@shepherdjerred/streambot/sources/ytdlp.ts";
import { fetchPoster } from "@shepherdjerred/streambot/metadata/tmdb.ts";
import { sourceLabel } from "@shepherdjerred/streambot/sources/source.ts";
import { StreambotStreamer } from "@shepherdjerred/streambot/streamer/streamer.ts";
import { CommandBot } from "@shepherdjerred/streambot/discord/command-bot.ts";
import type { PlaybackView } from "@shepherdjerred/streambot/discord/command-handler.ts";
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
import { UserIdSchema } from "@shepherdjerred/streambot/types/ids.ts";
import { getErrorMessage } from "@shepherdjerred/streambot/util/errors.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

/**
 * End-to-end test, run inside Dagger with real credentials (see `e2eStreambot`). Exercises BOTH
 * Discord identities — the command bot (logs in, registers slash commands on the guild) and the
 * userbot streamer (joins the voice channel and streams).
 *
 * Phases:
 *  0. (Optional) If `TMDB_API_KEY` is set, look up a known title and assert a live poster URL comes
 *     back — validates the real TMDB + image CDN integration. Skipped cleanly when no key is set.
 *  1. Generate a clip (with embedded chapters), drive it into the voice channel, assert `streaming`,
 *     assert the real `ffprobe` extracted its chapters, exercise a chapter seek, then capture + persist.
 *  2. Resume: boot a fresh session from the persisted state and assert it resumes near the same
 *     position and keeps playing. Exits non-zero on failure.
 */
const log = logger.child("e2e");
const TEST_CLIP = "/tmp/streambot-e2e.mp4";
const CHAPTERS_META = "/tmp/streambot-e2e-chapters.txt";
const REQUESTER = UserIdSchema.parse("100000000000000001");
const STREAM_HOLD_MS = 6000;
const CLIP_DURATION_SECONDS = 30;
/** Resume tolerance — wall-clock position can drift a little vs the captured checkpoint. */
const RESUME_TOLERANCE_SECONDS = 5;
/** Chapters embedded into the generated clip; asserted end-to-end via the real ffprobe in the image. */
const EXPECTED_CHAPTERS: readonly { title: string; startSeconds: number }[] = [
  { title: "Intro", startSeconds: 0 },
  { title: "Middle", startSeconds: 10 },
  { title: "End", startSeconds: 20 },
];
/** Tolerance (seconds) for the live position after a chapter seek (wall-clock drift + decode). */
const SEEK_TOLERANCE_SECONDS = 4;
/** A well-known title TMDB will always have a poster for (used by the optional poster check). */
const TMDB_PROBE_TITLE = "Big Buck Bunny";
const TMDB_PROBE_YEAR = 2008;

/** Build an ffmetadata chapters file (ms timebase) from {@link EXPECTED_CHAPTERS}. */
function chaptersMetadata(): string {
  const blocks = EXPECTED_CHAPTERS.map((chapter, index) => {
    const startMs = chapter.startSeconds * 1000;
    const endMs =
      (EXPECTED_CHAPTERS[index + 1]?.startSeconds ?? CLIP_DURATION_SECONDS) *
      1000;
    return `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${String(startMs)}\nEND=${String(endMs)}\ntitle=${chapter.title}`;
  });
  return `;FFMETADATA1\n${blocks.join("\n")}\n`;
}

async function generateClip(ffmpegPath: string): Promise<void> {
  await Bun.write(CHAPTERS_META, chaptersMetadata());
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
      // Third input: the chapter metadata, mapped in so ffprobe (and our chapters probe) can read it.
      "-i",
      CHAPTERS_META,
      "-map_metadata",
      "2",
      "-map",
      "0:v",
      "-map",
      "1:a",
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
  const streamer = new StreambotStreamer(config);
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

  const view = (): PlaybackView => {
    const { context } = actor.getSnapshot();
    return {
      state: JSON.stringify(actor.getSnapshot().value),
      current:
        context.current === null
          ? null
          : {
              title:
                context.resolved?.title ?? sourceLabel(context.current.source),
              requesterId: context.current.requesterId,
              chapters: context.resolved?.chapters ?? [],
            },
      queue: context.queue.map((entry) => ({
        title: sourceLabel(entry.source),
        requesterId: entry.requesterId,
        chapters: [],
      })),
      loop: context.loop,
      volume: context.volume,
    };
  };

  const commandBot = new CommandBot({
    config,
    dispatch: (event) => {
      actor.send(event);
    },
    view,
    library: () => [],
    setVolume: (percent) => streamer.setVolume(percent),
    seek: (seconds) => streamer.seek(seconds),
    expandPlaylist: (url, signal) => expandPlaylist(config, url, signal),
    streamerUserId: () => streamer.userId(),
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
 * Assert the playing item's chapters were extracted by the real `ffprobe` in the image and threaded
 * onto `context.resolved.chapters` (1-based, titles + start seconds matching {@link EXPECTED_CHAPTERS}).
 */
function assertResolvedChapters(session: Session): void {
  const chapters = session.actor.getSnapshot().context.resolved?.chapters ?? [];
  if (chapters.length !== EXPECTED_CHAPTERS.length) {
    throw new Error(
      `expected ${String(EXPECTED_CHAPTERS.length)} chapters, got ${String(chapters.length)}`,
    );
  }
  EXPECTED_CHAPTERS.forEach((expected, index) => {
    const got = chapters[index];
    if (
      got?.index !== index + 1 ||
      got.title !== expected.title ||
      got.startSeconds !== expected.startSeconds
    ) {
      throw new Error(
        `chapter ${String(index + 1)} mismatch: got ${JSON.stringify(got)}`,
      );
    }
  });
  log.info("e2e: chapters extracted", { count: chapters.length });
}

/**
 * Drive `/stream chapter 2` (a live seek to the second chapter's start) and assert the stream jumps
 * to that offset and keeps advancing — exercising the chapter → seek loop on a real Go-Live stream.
 */
async function assertChapterSeek(session: Session): Promise<void> {
  const target = session.actor.getSnapshot().context.resolved?.chapters[1];
  if (target === undefined) {
    throw new Error("no second chapter to seek to");
  }
  const ok = await session.streamer.seek(target.startSeconds);
  if (!ok) {
    throw new Error("chapter seek returned false (nothing playing)");
  }
  await sleep(1500);
  const position = session.streamer.getPosition() ?? 0;
  if (
    position < target.startSeconds ||
    position > target.startSeconds + SEEK_TOLERANCE_SECONDS
  ) {
    throw new Error(
      `chapter seek position off: ${String(position)} not within [${String(target.startSeconds)}, ${String(target.startSeconds + SEEK_TOLERANCE_SECONDS)}]`,
    );
  }
  await sleep(1000);
  const advanced = session.streamer.getPosition() ?? 0;
  if (advanced <= position) {
    throw new Error(
      `playback did not advance after chapter seek: ${String(advanced)} <= ${String(position)}`,
    );
  }
  log.info("e2e: chapter seek PASS", { jumpedTo: position, advanced });
}

/**
 * Optional live TMDB check — only runs when `TMDB_API_KEY` is configured. Looks up a well-known title
 * and asserts a poster URL comes back AND is live (HTTP 200), validating the real TMDB + image CDN.
 */
async function checkTmdbPoster(config: Config): Promise<void> {
  if (config.tmdb === undefined) {
    log.info("e2e: TMDB not configured — skipping poster check");
    return;
  }
  const poster = await fetchPoster(
    config.tmdb.apiKey,
    TMDB_PROBE_TITLE,
    TMDB_PROBE_YEAR,
  );
  if (poster === null) {
    throw new Error(
      `TMDB returned no poster for "${TMDB_PROBE_TITLE}" (${String(TMDB_PROBE_YEAR)})`,
    );
  }
  const head = await fetch(poster.posterUrl, {
    method: "HEAD",
    signal: AbortSignal.timeout(10_000),
  });
  if (!head.ok) {
    throw new Error(
      `TMDB poster URL not live (${String(head.status)}): ${poster.posterUrl}`,
    );
  }
  log.info("e2e: TMDB poster OK", {
    title: poster.tmdbTitle,
    url: poster.posterUrl,
  });
}

async function main(): Promise<number> {
  const baseConfig = loadConfig();
  await generateClip(baseConfig.ffmpegPath);

  const stateDir = await mkdtemp(path.join(tmpdir(), "streambot-e2e-state-"));
  const config: Config = {
    ...baseConfig,
    state: { dir: stateDir, resumeMaxAgeSeconds: 3600 },
  };
  const stateFile = stateFilePath(stateDir);
  const input: PlaybackInput = {
    guildId: config.discord.guildId,
    channelId: config.discord.videoChannelId,
    idleTimeoutMs: 5000,
  };

  try {
    // --- Phase 0: optional live TMDB poster check (skipped cleanly when no key is configured). ---
    await checkTmdbPoster(baseConfig);

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

      // Chapters: assert the real ffprobe populated context.resolved.chapters, then exercise a
      // chapter seek (the /stream chapter path) on the live stream.
      assertResolvedChapters(s1);
      await assertChapterSeek(s1);

      await sleep(STREAM_HOLD_MS);

      capturedPosition = s1.streamer.getPosition() ?? 0;
      log.info("e2e: cycle 1 position", { capturedPosition });
      if (capturedPosition < 3) {
        throw new Error(
          `expected playback to advance past 3s, got ${String(capturedPosition)}`,
        );
      }
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
      const resumedAt = s2.streamer.getPosition() ?? 0;
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
