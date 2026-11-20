/**
 * `coach/voice/turns` against a real database and the real run manager.
 *
 * The manager runs inline with an agent that answers at once, and the speech
 * calls are stubs, so a test decides what the server "heard". Everything
 * else (device auth, Explore access, the coach policy, the audit row written
 * with the run, the spend ledger, and the table's own checks) is the
 * production path.
 */

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  ExploreAnswerSchema,
  SCOUT_DESKTOP_API_ROUTES,
  SCOUT_DESKTOP_CONTRACT_HEADER,
  SCOUT_DESKTOP_CONTRACT_VERSION,
  ScoutDesktopVoiceTurnEventSchema,
  type ScoutDesktopVoiceTurnEvent,
} from "@scout-for-lol/data";
import type * as RunManagerModule from "#src/explore/runs/run-manager.ts";
import type { ExploreAgentRunner } from "#src/explore/runs/run-manager-types.ts";
import type { ExploreAgentParams } from "#src/explore/analysis/agent-types.ts";
import type { ExploreAgentResult } from "#src/explore/agent.ts";
import { resetConfigurationForTests } from "#src/configuration.ts";
import { secretDigest } from "#src/scout-client/secrets.ts";
import {
  createDurableExploreRunReservation,
  durableExploreQuotaRejection,
  IN_GAME_COACH_QUOTA_RULES,
} from "#src/temporal/durable-quota.ts";
import { createTestScoutClientDevice } from "#src/testing/scout-client/scout-client-device.ts";
import { createOfflineTrpcHarness } from "#src/testing/test-trpc-caller.ts";
import coachFixtures from "@scout-for-lol/data/scout-client/coach-context.fixtures.json" with { type: "json" };
import voiceFixture from "@scout-for-lol/data/scout-client/desktop-fixtures/coach-voice-turns.json" with { type: "json" };

/** Every turn the agent was asked, answered at once with a spoken answer. */
const asked: ExploreAgentParams[] = [];
const SPOKEN_ANSWER: ExploreAgentResult = {
  answer: ExploreAnswerSchema.parse({
    answer: "Build **Zhonya's Hourglass** next.",
    spokenAnswer: "Build Zhonya's Hourglass next.",
  }),
  preview: null,
  visualization: null,
  matchCards: [],
  loadoutCards: [],
};
const answerAtOnce: ExploreAgentRunner = async (params) => {
  asked.push(params);
  return SPOKEN_ANSWER;
};

let inlineManager: RunManagerModule.ExploreRunManager | null = null;
vi.doMock("#src/explore/runs/run-manager.ts", async (importOriginal) => {
  const original = await importOriginal<typeof RunManagerModule>();
  inlineManager = new original.ExploreRunManager({
    runAgent: answerAtOnce,
    inlineExecutionForTests: true,
  });
  return { ...original, exploreRunManager: inlineManager };
});

const heard = vi.hoisted(() => ({ transcript: "" }));
vi.doMock(
  "@shepherdjerred/voice-assistant/openai-audio.ts",
  async (importOriginal) => ({
    ...(await importOriginal()),
    transcribeVoiceQuestion: async () => heard.transcript,
    synthesizeVoiceAnswer: async () => new Uint8Array(4800),
  }),
);
vi.doMock("#src/voice-assistant/runtime.ts", () => ({
  resolveVoiceCredential: async () => "sk-test-voice",
}));

const trpc = await createOfflineTrpcHarness("scout-client-desktop-voice-turns");
const { handleScoutClientRoute } = await import("#src/scout-client/http.ts");
const {
  resetDesktopReadRateLimitForTests,
  resetDesktopWriteRateLimitsForTests,
} = await import("./rate-limit.ts");
const { resetExploreRateLimitStateForTests } =
  await import("#src/explore/rate-limit.ts");

const OWNER = DiscordAccountIdSchema.parse("900000000000009701");
const GUILD = DiscordGuildIdSchema.parse("100000000000009701");
const ORIGIN = "https://scout.invalid";
const TOKEN = `sct_${"v".repeat(43)}`;
const LIVE = coachFixtures.valid[0]?.body.live;
/** The stage variables these tests set, as they were before the file ran. */
const savedEnvironment = new Map(
  ["ENVIRONMENT", "EXPLORE_GUILD_ALLOWLIST"].map((key) => [key, Bun.env[key]]),
);

function runManager(): RunManagerModule.ExploreRunManager {
  if (inlineManager === null) throw new Error("the run manager was not built");
  return inlineManager;
}

/** Post a voice turn and read its events up to and including `until`. */
async function speakTurn(
  body: Record<string, unknown>,
  until: ScoutDesktopVoiceTurnEvent["type"],
): Promise<ScoutDesktopVoiceTurnEvent[]> {
  const url = new URL(SCOUT_DESKTOP_API_ROUTES.coach_voice_turns.path, ORIGIN);
  const response = await handleScoutClientRoute(
    new Request(url.href, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
        [SCOUT_DESKTOP_CONTRACT_HEADER]: String(SCOUT_DESKTOP_CONTRACT_VERSION),
      },
      body: JSON.stringify({
        trigger: "wake_word",
        conversationId: null,
        audio: voiceFixture.request.audio,
        ...body,
      }),
    }),
    url,
  );
  if (response?.body === null || response?.body === undefined) {
    throw new Error("the voice route answered no stream");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events: ScoutDesktopVoiceTurnEvent[] = [];
  let buffered = "";
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffered += decoder.decode(chunk.value, { stream: true });
    const frames = buffered.split("\n\n");
    buffered = frames.pop() ?? "";
    for (const frame of frames) {
      const data = frame
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice("data: ".length);
      if (data === undefined) continue;
      const event = ScoutDesktopVoiceTurnEventSchema.parse(JSON.parse(data));
      events.push(event);
      if (event.type === until) {
        await reader.cancel();
        return events;
      }
    }
  }
  return events;
}

beforeEach(async () => {
  Bun.env["ENVIRONMENT"] = "beta";
  Bun.env["EXPLORE_GUILD_ALLOWLIST"] = GUILD;
  resetConfigurationForTests();
  resetDesktopReadRateLimitForTests();
  resetDesktopWriteRateLimitsForTests();
  resetExploreRateLimitStateForTests();
  trpc.setMembership([{ guildId: GUILD, asAdmin: false }]);
  asked.length = 0;
  heard.transcript = "Hey Scout, what should I build next?";
  await trpc.prisma.scoutCoachTurn.deleteMany();
  await trpc.prisma.exploreSpend.deleteMany();
  await trpc.prisma.exploreMessage.deleteMany();
  await trpc.prisma.exploreConversation.deleteMany();
  await trpc.prisma.scoutInteractiveRun.deleteMany();
  await trpc.prisma.scoutClientDeviceVersion.deleteMany();
  await trpc.prisma.scoutClientDevice.deleteMany();
  await trpc.prisma.user.upsert({
    where: { discordId: OWNER },
    create: { discordId: OWNER, discordUsername: "owner" },
    update: {},
  });
  await createTestScoutClientDevice(trpc.prisma, OWNER, {
    tokenDigest: secretDigest(TOKEN),
    scopes: ["ingest", "explore"],
  });
});

afterEach(async () => {
  await vi.waitFor(() => {
    expect(runManager().list(OWNER)).toEqual([]);
  });
});

afterAll(async () => {
  await runManager().shutdown();
  for (const [key, value] of savedEnvironment) {
    if (value === undefined) Reflect.deleteProperty(Bun.env, key);
    else Bun.env[key] = value;
  }
  resetConfigurationForTests();
  await trpc.prisma.$disconnect();
});

describe("spoken coach turns against a real database", () => {
  test("a verified wake-word turn writes its proof with the run and books its transcription", async () => {
    const events = await speakTurn({ gameContext: { live: LIVE } }, "run");
    const started = events.find((event) => event.type === "run");
    if (started?.type !== "run") throw new Error("no run started");

    const rows = await trpc.prisma.scoutCoachTurn.findMany();
    expect(rows).toEqual([
      expect.objectContaining({
        ownerId: OWNER,
        runId: started.runId,
        initiation: "player_voice",
        voiceTrigger: "wake_word",
        wakeVerification: "verified",
        sectionsPresent: ["live"],
        sectionsAccepted: ["live"],
      }),
    ]);
    // The transcript never reaches the audit table.
    expect(JSON.stringify(rows)).not.toContain("build next");
    const params = await vi.waitFor(() => {
      const found = asked[0];
      if (found === undefined) throw new Error("the agent did not start");
      return found;
    });
    expect(params.question).toBe("what should i build next");
    expect(params.surface).toBe("voice");
    expect(params.coach).toEqual({ live: LIVE });
    expect(
      await trpc.prisma.exploreSpend.findMany({
        where: { runId: started.runId },
      }),
    ).toEqual([
      expect.objectContaining({
        model: "gpt-4o-transcribe",
        state: "settled",
        budgetMicros: 20,
      }),
    ]);
  });

  test("a wake phrase the server did not hear starts nothing and still books its transcription", async () => {
    heard.transcript = "what should I build next?";

    const events = await speakTurn({}, "done");

    expect(events).toEqual(voiceFixture.refusals[0]?.events);
    expect(await trpc.prisma.scoutCoachTurn.count()).toBe(0);
    expect(await trpc.prisma.exploreSpend.count()).toBe(1);
  });

  test("the table refuses a spoken turn without its proof, and proof on a typed one", async () => {
    await speakTurn({ trigger: "push_to_talk" }, "run");
    const row = await trpc.prisma.scoutCoachTurn.findFirstOrThrow();
    expect(row).toMatchObject({
      voiceTrigger: "push_to_talk",
      wakeVerification: "not_required",
    });
    const base = {
      ownerId: row.ownerId,
      deviceId: row.deviceId,
      conversationId: row.conversationId,
      questionMessageId: row.questionMessageId,
      sectionsPresent: [],
      sectionsAccepted: [],
      coachEnabled: true,
      liveAnswersEnabled: true,
    };
    for (const data of [
      { initiation: "player_voice" },
      {
        initiation: "player_voice",
        voiceTrigger: "wake_word",
        wakeVerification: "not_required",
      },
      {
        initiation: "player_typed",
        voiceTrigger: "push_to_talk",
        wakeVerification: "not_required",
      },
    ]) {
      await expect(
        trpc.prisma.scoutCoachTurn.create({
          data: { ...base, ...data, runId: globalThis.crypto.randomUUID() },
        }),
      ).rejects.toThrow();
    }
  });

  test("the in-game allowance counts live turns only, and its runs leave Explore's windows alone", async () => {
    const [minute] = IN_GAME_COACH_QUOTA_RULES;
    const device = await trpc.prisma.scoutClientDevice.findFirstOrThrow();
    const now = Date.now();
    await trpc.prisma.scoutCoachTurn.createMany({
      data: Array.from({ length: minute.limit }, () => ({
        ownerId: OWNER,
        deviceId: device.id,
        conversationId: globalThis.crypto.randomUUID(),
        runId: globalThis.crypto.randomUUID(),
        questionMessageId: globalThis.crypto.randomUUID(),
        initiation: "player_typed",
        sectionsPresent: ["live"],
        sectionsAccepted: ["live"],
        coachEnabled: true,
        liveAnswersEnabled: true,
      })),
    });

    expect(
      await durableExploreQuotaRejection(OWNER, now, trpc.prisma, "in_game"),
    ).toMatchObject({ reason: expect.stringContaining("in-game questions") });
    expect(
      await durableExploreQuotaRejection(OWNER, now, trpc.prisma, "explore"),
    ).toBeNull();

    await createDurableExploreRunReservation({
      database: trpc.prisma,
      id: globalThis.crypto.randomUUID(),
      ownerId: OWNER,
      conversationId: globalThis.crypto.randomUUID(),
      payload: "{}",
      allowance: "in_game",
    });
    expect(
      await trpc.prisma.scoutInteractiveRun.findFirstOrThrow(),
    ).toMatchObject({ quotaExempt: true });
  });
});
