import path from "node:path";
import { createActor } from "xstate";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import {
  createPlaybackMachine,
  type PlaybackActors,
} from "@shepherdjerred/streambot/machine/playback-machine.ts";
import {
  scanLibrary,
  type LibraryEntry,
  type LibraryRoot,
} from "@shepherdjerred/streambot/sources/library.ts";
import { resolveSource } from "@shepherdjerred/streambot/sources/resolve.ts";
import { expandPlaylist } from "@shepherdjerred/streambot/sources/ytdlp.ts";
import { sourceLabel } from "@shepherdjerred/streambot/sources/source.ts";
import { StreambotStreamer } from "@shepherdjerred/streambot/streamer/streamer.ts";
import { CommandBot } from "@shepherdjerred/streambot/discord/command-bot.ts";
import type { PlaybackView } from "@shepherdjerred/streambot/discord/command-handler.ts";
import {
  StatusReporter,
  type StatusSnapshot,
} from "@shepherdjerred/streambot/discord/status-reporter.ts";
import {
  loadState,
  saveState,
  stateFilePath,
} from "@shepherdjerred/streambot/state/persistence.ts";
import {
  buildResumeAnnouncement,
  buildResumeInput,
  buildSnapshot,
  resumeKeyFor,
} from "@shepherdjerred/streambot/state/resume.ts";
import { getErrorMessage } from "@shepherdjerred/streambot/util/errors.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

const LIBRARY_REFRESH_MS = 5 * 60 * 1000;
/** How often to checkpoint playback state to disk for resume. */
const CHECKPOINT_MS = 10 * 1000;
/** Once a resume has streamed healthily this long, mark it confirmed (reset the crash-loop counter). */
const RESUME_CONFIRM_MS = 30 * 1000;
/** Skip resuming an item that has crashed the bot this many consecutive boots (crash-loop guard). */
const MAX_RESUME_ATTEMPTS = 3;

async function main(): Promise<void> {
  const config = loadConfig();
  logger.info("starting streambot", {
    guildId: config.discord.guildId,
    statusChannelId: config.discord.statusChannelId,
    videoChannelId: config.discord.videoChannelId,
    videosDir: config.library.videosDir,
    mediaDirs: config.library.mediaDirs,
    hardwareAcceleration: config.stream.hardwareAcceleration,
  });

  const roots: LibraryRoot[] = [
    { dir: config.library.videosDir, label: "videos" },
    ...config.library.mediaDirs.map((dir) => ({
      dir,
      label: path.basename(dir),
    })),
  ];

  let library: LibraryEntry[] = [];
  async function refreshLibrary(): Promise<void> {
    try {
      library = await scanLibrary(roots, config.library.extensions);
      logger.info("library scanned", { count: library.length });
    } catch (error) {
      logger.error("library refresh failed", { error: getErrorMessage(error) });
    }
  }
  await refreshLibrary();
  const refreshTimer = setInterval(() => {
    void refreshLibrary();
  }, LIBRARY_REFRESH_MS);

  const streamer = new StreambotStreamer(config);
  const actors: PlaybackActors = {
    joinVoice: streamer.joinVoice,
    resolveSource: (input, signal) =>
      resolveSource(config, input.source, signal),
    runStream: streamer.runStream,
    leaveVoice: streamer.leaveVoice,
  };

  // Load any persisted playback so a restart (deploy/crash/OOM) resumes where it left off.
  const stateFile = stateFilePath(config.state.dir);
  const restored = await loadState(stateFile, config.state.resumeMaxAgeSeconds);
  const decision = buildResumeInput(
    restored,
    {
      guildId: config.discord.guildId,
      channelId: config.discord.videoChannelId,
      idleTimeoutMs: config.idleTimeoutSeconds * 1000,
    },
    { maxResumeAttempts: MAX_RESUME_ATTEMPTS },
  );
  if (restored !== null) {
    logger.info("loaded resume state", {
      resumedCurrent: decision.resumedCurrent,
      droppedForCrashLoop: decision.droppedForCrashLoop,
      queueLength: decision.input.initialQueue?.length ?? 0,
      seekSeconds: decision.input.initialSeekSeconds ?? 0,
    });
  }

  const actor = createActor(createPlaybackMachine(actors), {
    input: decision.input,
  });

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
            },
      queue: context.queue.map((entry) => ({
        title: sourceLabel(entry.source),
        requesterId: entry.requesterId,
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
    library: () => library,
    setVolume: (percent) => streamer.setVolume(percent),
    seek: (seconds) => streamer.seek(seconds),
    expandPlaylist: (url, signal) => expandPlaylist(config, url, signal),
    streamerUserId: () => streamer.userId(),
  });

  const reporter = new StatusReporter((message) =>
    commandBot.announce(message),
  );
  actor.subscribe((snapshot) => {
    const stateValue = snapshot.value;
    const snap: StatusSnapshot = {
      state:
        typeof stateValue === "string"
          ? stateValue
          : JSON.stringify(stateValue),
      currentTitle: snapshot.context.resolved?.title ?? null,
      currentRequester: snapshot.context.current?.requesterId ?? null,
      blockedNonce: snapshot.context.blockedNonce,
      blockedRequester: snapshot.context.lastBlockedRequester,
    };
    reporter.handle(snap);
  });
  // Start the machine only after login — on resume the queue is non-empty, so the machine
  // immediately tries to joinVoice, which needs the streamer connected.
  await Promise.all([streamer.login(), commandBot.login(), commandBot.ready]);
  actor.start();
  logger.info("streambot ready");

  // Tell viewers the bot is back (and what it's resuming), once, before the "now playing" line.
  const announcement = buildResumeAnnouncement(restored, decision);
  if (announcement !== null) {
    await commandBot.announce(announcement);
  }

  // Checkpoint playback to disk so a restart can resume. `lastKnownPositionSeconds` preserves the
  // resume offset even across a crash during re-resolution (when getPosition() is briefly null); the
  // resume is marked confirmed after a grace period, which resets the crash-loop counter.
  let persistResumeKey = decision.resumeKey;
  let persistResumeAttempts = decision.resumeAttempts;
  let resumeConfirmed = false;
  const bootAtMs = Date.now();
  let lastKnownPositionSeconds = decision.input.initialSeekSeconds ?? 0;

  async function saveSnapshot(): Promise<void> {
    const { context } = actor.getSnapshot();
    const live = streamer.getPosition();
    if (context.current === null) {
      lastKnownPositionSeconds = 0;
    } else if (live !== null) {
      lastKnownPositionSeconds = live;
    }
    if (!resumeConfirmed && Date.now() - bootAtMs >= RESUME_CONFIRM_MS) {
      resumeConfirmed = true;
    }
    if (resumeConfirmed) {
      persistResumeKey =
        context.current === null ? null : resumeKeyFor(context.current.source);
      persistResumeAttempts = 0;
    }
    const state = buildSnapshot({
      context,
      positionSeconds: lastKnownPositionSeconds,
      savedAt: Date.now(),
      resumeKey: persistResumeKey,
      resumeAttempts: persistResumeAttempts,
    });
    try {
      await saveState(stateFile, state);
    } catch (error) {
      logger.error("failed to persist resume state", {
        error: getErrorMessage(error),
      });
    }
  }

  const checkpointTimer = setInterval(() => {
    void saveSnapshot();
  }, CHECKPOINT_MS);

  let shuttingDown = false;
  async function shutdown(): Promise<void> {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info("shutting down");
    clearInterval(refreshTimer);
    clearInterval(checkpointTimer);
    // Persist final position BEFORE stopping the stream — getPosition() goes null once stopped.
    await saveSnapshot();
    actor.stop();
    await commandBot.destroy();
    await streamer.destroy();
    process.exit(0);
  }
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

await main();
