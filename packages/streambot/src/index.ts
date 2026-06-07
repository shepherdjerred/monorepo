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
import { getErrorMessage } from "@shepherdjerred/streambot/util/errors.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

const LIBRARY_REFRESH_MS = 5 * 60 * 1000;

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

  const actor = createActor(createPlaybackMachine(actors), {
    input: {
      guildId: config.discord.guildId,
      channelId: config.discord.videoChannelId,
      idleTimeoutMs: config.idleTimeoutSeconds * 1000,
    },
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
  actor.start();

  await Promise.all([streamer.login(), commandBot.login(), commandBot.ready]);
  logger.info("streambot ready");

  let shuttingDown = false;
  async function shutdown(): Promise<void> {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info("shutting down");
    clearInterval(refreshTimer);
    actor.stop();
    await commandBot.destroy();
    await streamer.destroy();
    process.exit(0);
  }
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

await main();
