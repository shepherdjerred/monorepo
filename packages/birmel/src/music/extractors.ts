import type { Readable } from "node:stream";
import { toError } from "@shepherdjerred/birmel/utils/errors.ts";
import type { Player, Track } from "discord-player";
import { YoutubeiExtractor } from "discord-player-youtubei";
import { logger } from "@shepherdjerred/birmel/utils/logger.ts";
import youtubeDl from "youtube-dl-exec";

type YoutubeDlProcess = ReturnType<typeof youtubeDl.exec>;

function extractYouTubeVideoId(url: string): string {
  const parsed = new URL(url);
  const searchParamId = parsed.searchParams.get("v");
  if (searchParamId != null && searchParamId.length > 0) {
    return searchParamId;
  }

  const pathId = parsed.pathname
    .split("/")
    .findLast((segment) => segment.length > 0);
  if (pathId != null && pathId.length > 0) {
    return pathId;
  }

  throw new Error(`Could not extract YouTube video id from ${url}`);
}

async function logYoutubeDlFailure(
  ytDlpProcess: YoutubeDlProcess,
  wasStoppedByCleanup: () => boolean,
): Promise<void> {
  try {
    await ytDlpProcess;
  } catch (error: unknown) {
    if (wasStoppedByCleanup()) {
      return;
    }
    logger.error("yt-dlp stream extraction failed", toError(error));
  }
}

function hasYoutubeDlProcessExited(ytDlpProcess: YoutubeDlProcess): boolean {
  return ytDlpProcess.exitCode != null || ytDlpProcess.signalCode != null;
}

function createYoutubeDlStream(track: Track): Promise<Readable> {
  const videoId = extractYouTubeVideoId(track.url);
  const ytDlpProcess = youtubeDl.exec(`https://youtu.be/${videoId}`, {
    format: track.live ? "best[height<=360]" : "bestaudio",
    ignoreConfig: true,
    jsRuntimes: "node",
    noPlaylist: true,
    noProgress: true,
    noWarnings: true,
    output: "-",
  });
  let stoppedByCleanup = false;
  void logYoutubeDlFailure(ytDlpProcess, () => stoppedByCleanup);

  const stream = ytDlpProcess.stdout;
  if (stream == null) {
    throw new Error("yt-dlp did not expose stdout for the stream");
  }

  const killProcess = (): void => {
    if (!ytDlpProcess.killed) {
      ytDlpProcess.kill();
    }
  };

  const stopAfterConsumerCleanup = (): void => {
    if (stream.readableEnded || hasYoutubeDlProcessExited(ytDlpProcess)) {
      return;
    }

    if (!ytDlpProcess.killed) {
      stoppedByCleanup = true;
      ytDlpProcess.kill();
    }
  };

  const stopAfterStreamError = (): void => {
    stoppedByCleanup = true;
    killProcess();
  };

  stream.on("close", stopAfterConsumerCleanup);
  stream.on("error", stopAfterStreamError);

  return Promise.resolve(stream);
}

export async function registerExtractors(player: Player): Promise<void> {
  try {
    // Use yt-dlp for stream extraction; direct YouTubei client streams currently fail against YouTube's player API.
    const extractor = await player.extractors.register(YoutubeiExtractor, {
      createStream: createYoutubeDlStream,
      streamOptions: {
        useClient: "ANDROID",
      },
    });
    if (extractor == null) {
      throw new Error("YouTubei extractor registration returned no extractor");
    }
    logger.info("Registered YouTubei extractor");
  } catch (error) {
    const normalizedError = toError(error);
    logger.error("Failed to register extractors", normalizedError);
    throw normalizedError;
  }
}
