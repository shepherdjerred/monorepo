import path from "node:path";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import {
  scanLibrary,
  type LibraryEntry,
  type LibraryRoot,
} from "@shepherdjerred/streambot/sources/library.ts";
import { resolveSource } from "@shepherdjerred/streambot/sources/resolve.ts";
import { sweepSubtitleTempDir } from "@shepherdjerred/streambot/sources/subtitle-io.ts";
import {
  expandPlaylist,
  listExtractors,
} from "@shepherdjerred/streambot/sources/ytdlp.ts";
import { UserbotPool } from "@shepherdjerred/streambot/pool/userbot-pool.ts";
import { SessionManager } from "@shepherdjerred/streambot/session/session-manager.ts";
import { CommandBot } from "@shepherdjerred/streambot/discord/command-bot.ts";
import { getErrorMessage } from "@shepherdjerred/streambot/util/errors.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";
import {
  startMetricsServer,
  stopMetricsServer,
} from "@shepherdjerred/streambot/observability/metrics.ts";
import { startGpuCollector } from "@shepherdjerred/streambot/observability/gpu-collector.ts";

const LIBRARY_REFRESH_MS = 5 * 60 * 1000;

async function main(): Promise<void> {
  const config = loadConfig();
  logger.info("starting streambot", {
    userTokenCount: config.discord.userTokens.length,
    videosDir: config.library.videosDir,
    mediaDirs: config.library.mediaDirs,
    hardwareAcceleration: config.stream.hardwareAcceleration,
    subtitles: config.subtitles.enabled,
  });

  startMetricsServer(config.observability.metricsPort);
  // GPU per-pod attribution via /proc/<pid>/fdinfo polling. Resolves the shared-renderD128
  // attribution problem (streambot + Plex + Jellyfin on the same node) without needing the broken
  // intel_gpu_top PMU path on Gen 12+ Raptor Lake.
  startGpuCollector();

  // Clear any subtitle temp files orphaned by a previous run (e.g. a resolve that was aborted before
  // the stream cleaned up after itself).
  await sweepSubtitleTempDir();

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

  // Log every userbot in and snapshot guild membership before anything tries to acquire one.
  const pool = new UserbotPool(config.discord.userTokens, config);
  await pool.start();

  // The command bot resolves sessions lazily so it can be constructed before the SessionManager
  // (which needs the bot's `announce`), breaking the wiring cycle.
  const refs: { sessions: SessionManager | null } = { sessions: null };
  const commandBot = new CommandBot({
    config,
    getSessions: () => {
      if (refs.sessions === null) {
        throw new Error("session manager not initialized");
      }
      return refs.sessions;
    },
    library: () => library,
    expandPlaylist: (url, signal) => expandPlaylist(config, url, signal),
    listSources: (signal) => listExtractors(config, signal),
  });
  const sessions = new SessionManager({
    config,
    pool,
    resolveSource: (input, signal) =>
      resolveSource(config, input.source, signal),
    announce: (channelId, message) => commandBot.announce(channelId, message),
  });
  refs.sessions = sessions;

  await Promise.all([commandBot.login(), commandBot.ready]);
  // Resume after login so the back-online announcements can be posted (and the pool is up).
  await sessions.resumeAll();
  logger.info("streambot ready");

  let shuttingDown = false;
  async function shutdown(): Promise<void> {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info("shutting down");
    clearInterval(refreshTimer);
    // Flush per-session resume state BEFORE stopping streams — getPosition() goes null once stopped.
    await sessions.destroyAll();
    await commandBot.destroy();
    await pool.destroy();
    await stopMetricsServer();
    process.exit(0);
  }
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

await main();
