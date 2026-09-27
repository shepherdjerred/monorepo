import { createActor, waitFor } from "xstate";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import { createPlaybackMachine } from "@shepherdjerred/streambot/machine/playback-machine.ts";
import { resolveSource } from "@shepherdjerred/streambot/sources/resolve.ts";
import { PinchtabSportsBrowser } from "@shepherdjerred/streambot/sports/pinchtab.ts";
import { BrowserSportsResolver } from "@shepherdjerred/streambot/sports/sports-resolver.ts";
import { StreambotStreamer } from "@shepherdjerred/streambot/streamer/streamer.ts";
import {
  ChannelIdSchema,
  GuildIdSchema,
  UserIdSchema,
} from "@shepherdjerred/streambot/types/ids.ts";
import { register } from "@shepherdjerred/streambot/observability/metrics-registry.ts";
import { z } from "zod";

/** Manual live test: browser discovery → ffprobe → ffmpeg → Discord Go Live. */
const environment = z
  .object({
    E2E_SPORTS_URL: z.url(),
    E2E_GUILD_ID: z.string(),
    E2E_VIDEO_CHANNEL_ID: z.string(),
    USER_TOKENS: z.string().min(1),
    PINCHTAB_TOKEN: z.string().min(1),
    E2E_PINCHTAB_PROFILE: z.string().min(1).optional(),
  })
  .parse(Bun.env);

const config = loadConfig({
  ...Bun.env,
  // This harness drives the real streamer, but does not log in the command bot.
  BOT_TOKEN: Bun.env["BOT_TOKEN"] ?? "unused-by-sports-e2e",
  VIDEOS_DIR: Bun.env["VIDEOS_DIR"] ?? "/tmp",
  PINCHTAB_BASE_URL: Bun.env["PINCHTAB_BASE_URL"] ?? "http://127.0.0.1:9867",
  STREAM_HARDWARE_ACCELERATION: "false",
});
const guildId = GuildIdSchema.parse(environment.E2E_GUILD_ID);
const channelId = ChannelIdSchema.parse(environment.E2E_VIDEO_CHANNEL_ID);
const requesterId = UserIdSchema.parse("100000000000000001");
const userToken = config.discord.userTokens[0];
if (userToken === undefined || config.pinchtab.baseUrl === undefined) {
  throw new Error("Sports e2e requires a streamer token and PinchTab URL");
}

const browser = new PinchtabSportsBrowser({
  baseUrl: config.pinchtab.baseUrl,
  token: config.pinchtab.token,
  ...(environment.E2E_PINCHTAB_PROFILE === undefined
    ? {}
    : { profileName: environment.E2E_PINCHTAB_PROFILE }),
});
const sportsResolver = new BrowserSportsResolver(browser);
const streamer = new StreambotStreamer(userToken, config);
const actor = createActor(
  createPlaybackMachine({
    joinVoice: streamer.joinVoice,
    resolveSource: (input, signal) =>
      resolveSource(config, input.source, signal, { sportsResolver }),
    runStream: streamer.runStream,
    leaveVoice: streamer.leaveVoice,
  }),
  { input: { guildId, channelId, idleTimeoutMs: 1000 } },
);

function frameCount(metrics: string, kind: "audio" | "video"): number {
  const found = new RegExp(
    String.raw`streambot_send_frametime_ratio_count\{[^}]*kind="${kind}"[^}]*\}\s+(\d+)`,
  ).exec(metrics);
  return Number(found?.[1] ?? 0);
}

async function waitForPlayback(): Promise<void> {
  try {
    await waitFor(actor, (snapshot) => snapshot.matches("streaming"), {
      timeout: 60_000,
    });
  } catch (error) {
    const snapshot = actor.getSnapshot();
    throw new Error(
      `Sports playback did not start (state=${snapshot.value}, reason=${snapshot.context.lastError ?? "none"})`,
      { cause: error },
    );
  }
}

async function main(): Promise<void> {
  try {
    await streamer.login();
    if (!streamer.guildIds().includes(guildId)) {
      throw new Error("Streamer is not a member of the test guild");
    }
    actor.start();
    actor.send({
      type: "ADD",
      source: {
        kind: "url",
        url: environment.E2E_SPORTS_URL,
        subtitles: { enabled: false },
      },
      requesterId,
    });
    await waitForPlayback();
    const deadline = Date.now() + 30_000;
    for (;;) {
      const metrics = await register.metrics();
      const videoFrames = frameCount(metrics, "video");
      const audioFrames = frameCount(metrics, "audio");
      if (videoFrames > 0 && audioFrames > 0) {
        if (!/streambot_stream_active\{[^}]*\}\s+1\b/.test(metrics)) {
          throw new Error(
            "Discord frames were sent but the stream is no longer active",
          );
        }
        if (!/streambot_source_info\{[^}]*\}\s+1\b/.test(metrics)) {
          throw new Error("Live source was not ffprobed");
        }
        console.info(
          "sports e2e PASS",
          JSON.stringify({
            guildId,
            channelId,
            streamerUserId: streamer.userId(),
            videoFrames,
            audioFrames,
          }),
        );
        await Bun.sleep(10_000);
        return;
      }
      if (!actor.getSnapshot().matches("streaming")) {
        throw new Error(
          `Stream left playback before sending audio and video: ${actor.getSnapshot().context.lastError ?? "unknown error"}`,
        );
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out waiting for Discord frames (video=${String(videoFrames)}, audio=${String(audioFrames)})`,
        );
      }
      await Bun.sleep(500);
    }
  } finally {
    actor.stop();
    await streamer.destroy();
  }
}

const code = await main().then(
  () => 0,
  (error: unknown) => {
    const name = error instanceof Error ? error.name : "unknown error";
    const detail =
      error instanceof Error
        ? error.message.replaceAll(/https?:\/\/\S+/g, "[redacted URL]")
        : "no error detail";
    console.error("sports e2e failed", name, detail);
    return 1;
  },
);
process.exit(code);
