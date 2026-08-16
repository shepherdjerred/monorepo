import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import { NOOP_CARD_PORT } from "@shepherdjerred/streambot/discord/player-card-manager.ts";
import { UserbotPool } from "@shepherdjerred/streambot/pool/userbot-pool.ts";
import { SessionManager } from "@shepherdjerred/streambot/session/session-manager.ts";
import type { LibraryEntry } from "@shepherdjerred/streambot/sources/library.ts";
import { resolveSource } from "@shepherdjerred/streambot/sources/resolve.ts";
import {
  ChannelIdSchema,
  GuildIdSchema,
  UserIdSchema,
} from "@shepherdjerred/streambot/types/ids.ts";
import { initializeLocalVoiceModels } from "@shepherdjerred/streambot/voice/local-models.ts";
import {
  assertDaveReadiness,
  runAuthorizationAndQueries,
  runConcurrentIsolation,
  runNegativeSoak,
  runOverlappingSpeakers,
  runStopAndTeardown,
  runToolMatrix,
  type VoiceAcceptanceContext,
} from "./voice-assistant-scenarios.ts";
import { runDtxEndpoint } from "./voice-assistant-dtx.ts";
import { runInvalidCredentialIsolation } from "./voice-assistant-failures.ts";
import {
  BASELINE_CLIP,
  LOCAL_CLIP,
  connectSpeaker,
  firstTwo,
  generateClip,
  requiredList,
  startPlayback,
  waitUntil,
  type Speaker,
} from "./voice-assistant-support.ts";

function voiceLibrary(): LibraryEntry[] {
  return [
    {
      title: "Moonlight",
      path: LOCAL_CLIP,
      relativePath: "moonlight.mp4",
      library: "voice-e2e",
    },
    {
      title: "The Matrix",
      path: LOCAL_CLIP,
      relativePath: "the-matrix.mp4",
      library: "voice-e2e",
    },
  ];
}

async function runScenarios(context: VoiceAcceptanceContext): Promise<void> {
  await assertDaveReadiness(context);
  if (Bun.env["E2E_VOICE_EXPECT_INVALID_CREDENTIALS"] === "true") {
    await runInvalidCredentialIsolation(context);
    process.stdout.write(
      "PASS invalid OpenAI credentials failed closed while Go Live playback continued\n",
    );
    return;
  }
  await runConcurrentIsolation(context);
  await runAuthorizationAndQueries(context);
  await runDtxEndpoint(context);
  await runToolMatrix(context);
  await runOverlappingSpeakers(context);
  await runNegativeSoak(context);
  await runStopAndTeardown(context);
  process.stdout.write(
    "PASS attributed DAVE replies, exact metric deltas, source restrictions, DTX endpointing, all voice tools, authorization, overlapping-speaker locking, negative soak, stop confirmation, and same-guild isolation\n",
  );
}

async function main(): Promise<void> {
  const baseConfig = loadConfig();
  if (!baseConfig.voice.enabled) {
    throw new Error("Set VOICE_ASSISTANT_ENABLED=true for the voice E2E");
  }
  const channelIds = firstTwo(
    requiredList("E2E_VOICE_CHANNEL_IDS").map((value) =>
      ChannelIdSchema.parse(value),
    ),
    "voice channel ids",
  );
  const speakerTokens = firstTwo(
    requiredList("E2E_VOICE_SPEAKER_TOKENS"),
    "voice speaker tokens",
  );
  const guildId = GuildIdSchema.parse(Bun.env["E2E_GUILD_ID"]);
  const stateDir = await mkdtemp(path.join(tmpdir(), "streambot-voice-e2e-"));
  const speakers: Speaker[] = [];
  speakers.push(
    await connectSpeaker(speakerTokens[0], guildId, channelIds[0]),
    await connectSpeaker(speakerTokens[1], guildId, channelIds[1]),
  );
  const speakerOne = speakers[0];
  const speakerTwo = speakers[1];
  if (speakerOne === undefined || speakerTwo === undefined) {
    throw new Error("Voice E2E speakers failed to connect");
  }
  const requester = UserIdSchema.parse(speakerOne.userId);
  const config: Config = {
    ...baseConfig,
    discord: { ...baseConfig.discord, adminIds: [requester] },
    idleTimeoutSeconds: 120,
    state: { dir: stateDir, resumeMaxAgeSeconds: 3600 },
  };
  await Promise.all([
    generateClip(config.ffmpegPath, BASELINE_CLIP),
    generateClip(config.ffmpegPath, LOCAL_CLIP),
  ]);
  const models = await initializeLocalVoiceModels(config.voice);
  if (models === null) throw new Error("Voice models did not initialize");
  const pool = new UserbotPool(config.discord.userTokens, config);
  await pool.start();
  const library = voiceLibrary();
  const sessions = new SessionManager({
    config,
    pool,
    cards: NOOP_CARD_PORT,
    announce: (_channelId, message) => {
      process.stdout.write(`${message}\n`);
      return Promise.resolve();
    },
    resolveSource: (input, signal) =>
      resolveSource(config, input.source, signal, input.preResolved),
    library: () => library,
    resolvePlaySource: (source, signal) =>
      resolveSource(config, source, signal),
    voiceModels: models,
  });
  try {
    const first = sessions.ensureForPlay({
      guildId,
      voiceChannelId: channelIds[0],
      statusChannelId: channelIds[0],
    });
    const second = sessions.ensureForPlay({
      guildId,
      voiceChannelId: channelIds[1],
      statusChannelId: channelIds[1],
    });
    if (first === null || second === null) {
      throw new Error("Voice E2E requires two free userbots in the test guild");
    }
    startPlayback(first, speakerOne.userId);
    startPlayback(second, speakerOne.userId);
    await Promise.all([
      waitUntil(
        "first baseline stream",
        () => first.view().state === "streaming",
      ),
      waitUntil(
        "second baseline stream",
        () => second.view().state === "streaming",
      ),
    ]);
    const firstAssistantId = first.assistantUserId();
    const secondAssistantId = second.assistantUserId();
    if (firstAssistantId === null || secondAssistantId === null) {
      throw new Error("Active sessions did not expose assistant identities");
    }
    await runScenarios({
      config,
      sessions,
      guildId,
      channelIds,
      first,
      second,
      speakerOne,
      speakerTwo,
      firstAssistantId,
      secondAssistantId,
    });
  } finally {
    await sessions.destroyAll();
    await pool.destroy();
    for (const speaker of speakers) {
      speaker.streamer.leaveVoice();
      speaker.client.destroy();
    }
    await Promise.all([
      rm(stateDir, { recursive: true }),
      rm(BASELINE_CLIP),
      rm(LOCAL_CLIP),
    ]);
  }
}

await main();
