import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client as ModeratorClient } from "discord.js-selfbot-v13";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import { SessionManager } from "@shepherdjerred/streambot/session/session-manager.ts";
import { resolveSource } from "@shepherdjerred/streambot/sources/resolve.ts";
import { StreambotStreamer } from "@shepherdjerred/streambot/streamer/streamer.ts";
import type {
  UserbotEntry,
  UserbotProvider,
} from "@shepherdjerred/streambot/pool/userbot-pool.ts";
import type { Announcement } from "@shepherdjerred/streambot/discord/status-reporter.ts";
import {
  ChannelIdSchema,
  GuildIdSchema,
  UserIdSchema,
} from "@shepherdjerred/streambot/types/ids.ts";

const TEST_CLIP = "/tmp/streambot-voice-recovery-e2e.mp4";
const TEST_SIDECAR = "/tmp/streambot-voice-recovery-e2e.en.srt";
const CLIP_DURATION_SECONDS = 8;
const REQUESTER = UserIdSchema.parse("100000000000000001");

type SingleUserbotPool = {
  readonly provider: UserbotProvider;
  readonly acquireCount: () => number;
};

function createSingleUserbotPool(
  streamer: StreambotStreamer,
): SingleUserbotPool {
  const entry: UserbotEntry = {
    userbot: streamer,
    guildIds: new Set(streamer.guildIds()),
    busy: false,
  };
  let acquisitions = 0;
  return {
    provider: {
      acquire: (guildId) => {
        if (entry.busy || !entry.guildIds.has(guildId)) {
          return null;
        }
        acquisitions += 1;
        entry.busy = true;
        return entry;
      },
      release: (released) => {
        if (released !== entry) {
          throw new Error("live E2E pool received an unknown userbot");
        }
        entry.busy = false;
      },
      canServe: (guildId) => entry.guildIds.has(guildId),
    },
    acquireCount: () => acquisitions,
  };
}

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
      `ffmpeg live E2E fixture generation failed (code ${String(code)}): ${stderr.trim()}`,
    );
  }
  await Bun.write(
    TEST_SIDECAR,
    "1\n00:00:00,000 --> 00:00:07,500\nstreambot EOF and 4014 recovery E2E\n",
  );
}

async function waitUntil(
  description: string,
  predicate: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`timed out waiting for ${description}`);
    }
    await Bun.sleep(100);
  }
}

async function loginModerator(token: string): Promise<ModeratorClient> {
  const moderator = new ModeratorClient();
  const ready = new Promise<void>((resolve) => {
    moderator.once("ready", () => {
      resolve();
    });
  });
  await moderator.login(token);
  await ready;
  return moderator;
}

function announcementText(announcement: Announcement): string {
  return typeof announcement === "string" ? announcement : announcement.content;
}

async function main(): Promise<void> {
  const baseConfig = loadConfig();
  const guildId = GuildIdSchema.parse(Bun.env["E2E_GUILD_ID"]);
  const channelId = ChannelIdSchema.parse(Bun.env["E2E_VIDEO_CHANNEL_ID"]);
  const userToken = baseConfig.discord.userTokens[0];
  if (userToken === undefined) {
    throw new Error("live E2E requires one userbot token");
  }
  const moderatorToken = Bun.env["E2E_MODERATOR_USER_TOKEN"];
  if (moderatorToken === undefined || moderatorToken.length === 0) {
    throw new Error("live E2E requires E2E_MODERATOR_USER_TOKEN");
  }
  const stateDir = await mkdtemp(
    path.join(tmpdir(), "streambot-voice-recovery-e2e-"),
  );
  const config: Config = {
    ...baseConfig,
    reconnect: {
      enabled: true,
      delaySeconds: 2,
      maxAttempts: 1,
    },
    state: { dir: stateDir, resumeMaxAgeSeconds: 3600 },
  };
  const streamer = new StreambotStreamer(userToken, config);
  const announcements: string[] = [];

  await generateClip(config.ffmpegPath);
  const [, moderator] = await Promise.all([
    streamer.login(),
    loginModerator(moderatorToken),
  ]);
  const pool = createSingleUserbotPool(streamer);
  const sessions = new SessionManager({
    config,
    pool: pool.provider,
    resolveSource: (input, signal) =>
      resolveSource(config, input.source, signal),
    announce: (_statusChannelId, announcement) => {
      const content = announcementText(announcement);
      announcements.push(content);
      process.stdout.write(`${content}\n`);
      return Promise.resolve();
    },
  });

  try {
    const natural = sessions.ensureForPlay({
      guildId,
      voiceChannelId: channelId,
      statusChannelId: channelId,
    });
    if (natural === null) {
      throw new Error("live E2E could not acquire the test userbot");
    }
    natural.dispatch({
      type: "ADD",
      source: { kind: "file", path: TEST_CLIP, title: "natural-eof-e2e" },
      requesterId: REQUESTER,
    });
    await waitUntil(
      "natural EOF stream to start",
      () => natural.view().state === "streaming",
      60_000,
    );
    await waitUntil(
      "subtitled stream to reach the natural-end waiting state",
      () => natural.view().state === "waiting",
      30_000,
    );
    if (natural.view().current !== null) {
      throw new Error("natural EOF left the finished item active");
    }
    process.stdout.write(
      "PASS natural subtitled EOF advanced without a stall retry\n",
    );
    natural.dispatch({ type: "STOP" });
    await waitUntil(
      "natural EOF session to stop after verification",
      () => sessions.getExisting(guildId, channelId) === null,
      15_000,
    );

    const deliberate = sessions.ensureForPlay({
      guildId,
      voiceChannelId: channelId,
      statusChannelId: channelId,
    });
    if (deliberate === null) {
      throw new Error("live E2E could not reacquire the test userbot");
    }
    deliberate.dispatch({
      type: "ADD",
      source: {
        kind: "file",
        path: TEST_CLIP,
        title: "deliberate-4014-e2e",
      },
      requesterId: REQUESTER,
    });
    await waitUntil(
      "deliberate-disconnect stream to start",
      () => deliberate.view().state === "streaming",
      60_000,
    );
    const active = sessions.activeSessionByChannel(guildId, channelId);
    if (active === null || active.userId === null) {
      throw new Error("live E2E streamer user id was unavailable");
    }

    const guild = moderator.guilds.cache.get(guildId);
    if (guild === undefined) {
      throw new Error("moderator test identity is not in the E2E guild");
    }
    const member = await guild.members.fetch(active.userId);
    await member.voice.disconnect("Streambot deliberate 4014 live E2E");
    await waitUntil(
      "4014-disconnected session to tear down",
      () => sessions.getExisting(guildId, channelId) === null,
      15_000,
    );
    await Bun.sleep((config.reconnect.delaySeconds + 2) * 1000);
    if (sessions.getExisting(guildId, channelId) !== null) {
      throw new Error("deliberate 4014 unexpectedly reconnected");
    }
    if (pool.acquireCount() !== 2) {
      throw new Error(
        `deliberate 4014 reacquired a userbot (${String(pool.acquireCount())} total acquisitions)`,
      );
    }
    if (!announcements.some((message) => message.includes("4014"))) {
      throw new Error("deliberate disconnect did not surface close code 4014");
    }
    process.stdout.write(
      "PASS deliberate 4014 stayed disconnected without reacquiring\n",
    );
  } finally {
    await sessions.destroyAll();
    await streamer.destroy();
    try {
      moderator.destroy();
    } catch (error) {
      process.stderr.write(`moderator destroy failed: ${String(error)}\n`);
    }
    await rm(stateDir, { recursive: true });
    await rm(TEST_CLIP);
    await rm(TEST_SIDECAR);
  }
}

await main();
