import { Readable } from "node:stream";
import { z } from "zod";
import { Client, GatewayIntentBits } from "discord.js";
import {
  Player,
  QueryType,
  StreamType,
  createAudioResource,
  type ExtractorStreamable,
} from "discord-player";

import { registerExtractors } from "@shepherdjerred/birmel/music/extractors.ts";

const EnvSchema = z.object({
  BIRMEL_E2E_YOUTUBE_QUERY: z
    .string()
    .min(1, "BIRMEL_E2E_YOUTUBE_QUERY is required"),
  BIRMEL_E2E_TIMEOUT_MS: z.coerce.number().int().min(5000).default(45_000),
});

const DemuxableStreamSchema = z.object({
  $fmt: z.string().min(1),
  stream: z.instanceof(Readable),
});

const youtubeiExtractorId =
  "com.retrouser955.discord-player.discord-player-youtubei";

type NormalizedStreamable = {
  input: Readable | string;
  inputType: StreamType;
  sourceFormat: string;
};

type ResourceMetadata = {
  title: string;
  url: string;
  source: string;
};

type DiscordAudioResource = {
  readonly playStream: Readable;
  readonly ended: boolean;
  playbackDuration: number;
  metadata: ResourceMetadata;
  read: () => Buffer | null;
};

function ensure(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function requireValue<T>(
  value: T | null | undefined,
  message: string,
): NonNullable<T> {
  if (value == null) {
    throw new Error(message);
  }
  return value;
}

function streamTypeForFormat(format: string): StreamType {
  switch (format) {
    case "pcm":
    case "raw":
      return StreamType.Raw;
    case "opus":
      return StreamType.Opus;
    case "ogg/opus":
      return StreamType.OggOpus;
    case "webm/opus":
      return StreamType.WebmOpus;
    case "arbitrary":
      return StreamType.Arbitrary;
    default:
      throw new Error(`Unsupported extractor stream format: ${format}`);
  }
}

function normalizeStreamable(
  streamable: ExtractorStreamable,
): NormalizedStreamable {
  if (typeof streamable === "string") {
    return {
      input: streamable,
      inputType: StreamType.Arbitrary,
      sourceFormat: "url",
    };
  }

  if (streamable instanceof Readable) {
    return {
      input: streamable,
      inputType: StreamType.Arbitrary,
      sourceFormat: "readable",
    };
  }

  const parsed = DemuxableStreamSchema.parse(streamable);
  return {
    input: parsed.stream,
    inputType: streamTypeForFormat(parsed.$fmt),
    sourceFormat: parsed.$fmt,
  };
}

async function readOneDiscordPacket(
  resource: DiscordAudioResource,
  timeoutMs: number,
): Promise<Buffer> {
  let streamError: string | undefined;
  resource.playStream.once("error", (error) => {
    streamError = error instanceof Error ? error.message : String(error);
  });

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (streamError !== undefined) {
      throw new Error(`Discord audio resource stream failed: ${streamError}`);
    }

    ensure(!resource.ended, "Discord audio resource ended before a packet");

    const packet = resource.read();
    if (Buffer.isBuffer(packet) && packet.length > 0) {
      return packet;
    }

    await Bun.sleep(100);
  }

  throw new Error("Timed out waiting for a Discord Opus packet");
}

async function main(): Promise<void> {
  const env = EnvSchema.parse(Bun.env);

  const client = new Client({
    intents: [GatewayIntentBits.GuildVoiceStates],
  });
  const player = new Player(client, {
    lagMonitor: 0,
    queryCache: null,
  });
  let normalized: NormalizedStreamable | undefined;
  let resource: DiscordAudioResource | undefined;
  player.on("error", (error) => {
    console.warn(
      `Birmel YouTube stream E2E player warning: ${error instanceof Error ? error.message : String(error)}`,
    );
  });

  try {
    ensure(
      !player.scanDeps().includes("FFmpeg/Avconv not found"),
      "FFmpeg/Avconv is required to turn arbitrary YouTube audio into Discord packets",
    );

    await registerExtractors(player);
    ensure(
      player.extractors.resolve(youtubeiExtractorId) !== undefined,
      "YouTubei extractor registration failed",
    );

    const searchResult = await player.search(env.BIRMEL_E2E_YOUTUBE_QUERY, {
      searchEngine: QueryType.AUTO,
    });
    ensure(
      searchResult.hasTracks(),
      `No YouTube tracks found for query: ${env.BIRMEL_E2E_YOUTUBE_QUERY}`,
    );

    const track = requireValue(
      searchResult.tracks.at(0),
      "Search returned no first track",
    );
    ensure(track.title.length > 0, "Resolved track has an empty title");
    ensure(track.url.length > 0, "Resolved track has an empty URL");
    ensure(
      track.source === "youtube",
      `Expected a YouTube track, got source ${String(track.source)}`,
    );

    const extractor = requireValue(
      track.extractor ?? searchResult.extractor,
      "Resolved track did not retain a source extractor",
    );
    const streamable = await extractor.stream(track);
    normalized = normalizeStreamable(streamable);

    resource = createAudioResource(normalized.input, {
      inputType: normalized.inputType,
      metadata: {
        title: track.title,
        url: track.url,
        source: String(track.source),
      },
      silencePaddingFrames: 0,
    });

    ensure(
      resource.playStream.readable,
      "Discord audio resource playStream is not readable",
    );
    ensure(
      resource.metadata.title === track.title,
      "Discord audio resource metadata did not retain the track title",
    );

    const packet = await readOneDiscordPacket(
      resource,
      env.BIRMEL_E2E_TIMEOUT_MS,
    );
    ensure(
      resource.playbackDuration >= 20,
      "Discord audio resource did not account for packet playback duration",
    );

    console.log(
      `Birmel YouTube stream E2E passed: "${track.title}" produced a ${String(packet.length)} byte Discord Opus packet from ${normalized.sourceFormat}`,
    );
  } finally {
    resource?.playStream.destroy();
    if (normalized?.input instanceof Readable && !normalized.input.destroyed) {
      normalized.input.destroy();
    }
    try {
      await player.extractors.unregisterAll();
    } catch (error) {
      console.warn(
        `Birmel YouTube stream E2E extractor cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await client.destroy();
  }
}

await main();
