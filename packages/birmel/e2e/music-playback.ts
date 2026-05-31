import { z } from "zod";
import { ChannelType, Events } from "discord.js";

const EnvSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, "DISCORD_TOKEN is required"),
  BIRMEL_E2E_GUILD_ID: z.string().min(1, "BIRMEL_E2E_GUILD_ID is required"),
  BIRMEL_E2E_TEXT_CHANNEL_ID: z
    .string()
    .min(1, "BIRMEL_E2E_TEXT_CHANNEL_ID is required"),
  BIRMEL_E2E_VOICE_CHANNEL_ID: z
    .string()
    .min(1, "BIRMEL_E2E_VOICE_CHANNEL_ID is required"),
  BIRMEL_E2E_YOUTUBE_QUERY: z
    .string()
    .min(1, "BIRMEL_E2E_YOUTUBE_QUERY is required"),
  BIRMEL_E2E_PLAYBACK_SECONDS: z.coerce.number().int().min(1).default(5),
  BIRMEL_E2E_TIMEOUT_MS: z.coerce.number().int().min(5000).default(45_000),
});

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

async function waitFor(
  description: string,
  predicate: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }
    await Bun.sleep(500);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function main(): Promise<void> {
  const env = EnvSchema.parse(Bun.env);

  Bun.env["DATABASE_URL"] ??= "file:/tmp/birmel-music-e2e.db";
  Bun.env["LOG_LEVEL"] ??= "info";

  const { getDiscordClient, destroyDiscordClient } =
    await import("@shepherdjerred/birmel/discord/client.ts");
  const { initializeMusicPlayer, destroyMusicPlayer, getMusicPlayer } =
    await import("@shepherdjerred/birmel/music/player.ts");
  const { handlePlay, handleStop } =
    await import("@shepherdjerred/birmel/agent-tools/tools/music/playback-actions.ts");
  const { disconnectPrisma } =
    await import("@shepherdjerred/birmel/database/index.ts");

  const client = getDiscordClient();
  let playerStarted = false;
  let playerErrorMessage: string | undefined;

  try {
    await client.login(env.DISCORD_TOKEN);
    await new Promise<void>((resolve, reject) => {
      if (client.isReady()) {
        resolve();
        return;
      }

      const timer = setTimeout(() => {
        reject(new Error("Timed out waiting for Discord ready event"));
      }, env.BIRMEL_E2E_TIMEOUT_MS);

      client.once(Events.ClientReady, () => {
        clearTimeout(timer);
        resolve();
      });
    });

    const guild = await client.guilds.fetch(env.BIRMEL_E2E_GUILD_ID);
    ensure(
      guild.id === env.BIRMEL_E2E_GUILD_ID,
      `Logged in, but fetched unexpected guild ${guild.id}`,
    );

    const textChannel = requireValue(
      await client.channels.fetch(env.BIRMEL_E2E_TEXT_CHANNEL_ID),
      "Configured text channel was not found",
    );
    ensure(
      textChannel.isTextBased(),
      `Configured text channel ${env.BIRMEL_E2E_TEXT_CHANNEL_ID} is not text-based`,
    );

    const voiceChannel = requireValue(
      await client.channels.fetch(env.BIRMEL_E2E_VOICE_CHANNEL_ID),
      "Configured voice channel was not found",
    );
    ensure(
      voiceChannel.type === ChannelType.GuildVoice,
      `Configured voice channel ${env.BIRMEL_E2E_VOICE_CHANNEL_ID} is not a guild voice channel`,
    );

    await initializeMusicPlayer();
    const player = getMusicPlayer();

    player.events.on("playerStart", () => {
      playerStarted = true;
    });

    player.events.on("playerError", (_queue, error) => {
      playerErrorMessage = error.message;
    });

    player.events.on("error", (_queue, error) => {
      playerErrorMessage = error.message;
    });

    const playResult = await handlePlay(
      env.BIRMEL_E2E_GUILD_ID,
      env.BIRMEL_E2E_TEXT_CHANNEL_ID,
      env.BIRMEL_E2E_VOICE_CHANNEL_ID,
      env.BIRMEL_E2E_YOUTUBE_QUERY,
    );

    ensure(playResult.success, playResult.message);
    const playData = requireValue(
      playResult.data,
      "Play result did not include track data",
    );
    ensure(
      playData.title.length > 0,
      "Play result included an empty track title",
    );

    await waitFor(
      "Discord playerStart event",
      () => playerStarted || playerErrorMessage !== undefined,
      env.BIRMEL_E2E_TIMEOUT_MS,
    );

    ensure(
      playerErrorMessage === undefined,
      `Playback failed: ${playerErrorMessage ?? "unknown player error"}`,
    );

    const queue = requireValue(
      player.queues.get(env.BIRMEL_E2E_GUILD_ID),
      "Playback did not create a guild queue",
    );
    ensure(queue.isPlaying(), "Guild queue exists but is not playing");
    const currentTrack = requireValue(
      queue.currentTrack,
      "Guild queue has no current track",
    );
    ensure(
      currentTrack.title.length > 0,
      "Guild queue current track has an empty title",
    );

    await Bun.sleep(env.BIRMEL_E2E_PLAYBACK_SECONDS * 1000);

    const activeQueue = requireValue(
      player.queues.get(env.BIRMEL_E2E_GUILD_ID),
      "Guild queue disappeared during playback",
    );
    ensure(activeQueue.isPlaying(), "Guild queue stopped before verification");

    const stopResult = handleStop(env.BIRMEL_E2E_GUILD_ID);
    ensure(stopResult.success, stopResult.message);

    console.log(
      `Birmel music E2E passed: played "${playData.title}" for ${String(env.BIRMEL_E2E_PLAYBACK_SECONDS)}s`,
    );
  } finally {
    try {
      handleStop(env.BIRMEL_E2E_GUILD_ID);
    } catch (error) {
      console.warn(
        `Birmel music E2E cleanup stop failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await destroyMusicPlayer();
    await destroyDiscordClient();
    await disconnectPrisma();
  }
}

await main();
