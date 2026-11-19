import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  SCOUT_DESKTOP_API_ROUTES,
  SCOUT_DESKTOP_CONTRACT_HEADER,
  SCOUT_DESKTOP_CONTRACT_VERSION,
  SCOUT_DESKTOP_VOICE_MAX_WAV_BYTES,
  ScoutDesktopApiErrorSchema,
  ScoutDesktopConversationGetResponseSchema,
  ScoutDesktopVoiceTurnEventSchema,
  type ScoutDesktopVoiceTurnEvent,
} from "@scout-for-lol/data";
import { z } from "zod";
import getFixture from "@scout-for-lol/data/scout-client/desktop-fixtures/explore-conversations-get.json" with { type: "json" };
import voiceFixture from "@scout-for-lol/data/scout-client/desktop-fixtures/coach-voice-turns.json" with { type: "json" };
import coachFixtures from "@scout-for-lol/data/scout-client/coach-context.fixtures.json" with { type: "json" };

/**
 * `coach/voice/turns` with no database, no Temporal and no provider: every
 * boundary the route crosses is a spy, so what is under test is the route's
 * own order of checks and the proof of initiation it hands the run manager.
 */

const mocks = vi.hoisted(() => ({
  findDevice: vi.fn(),
  findUser: vi.fn(),
  findRun: vi.fn(),
  exploreAccess: vi.fn(),
  isPolicyEnabled: vi.fn(),
  startRun: vi.fn(),
  subscribeRun: vi.fn(),
  settleRun: vi.fn(),
  transcribe: vi.fn(),
  synthesize: vi.fn(),
  spendingStatus: vi.fn(),
  recordAudio: vi.fn(),
  loadResult: vi.fn(),
  loadTranscript: vi.fn(),
  voiceCredential: vi.fn(),
}));

vi.mock("#src/database/index.ts", () => ({
  prisma: {
    scoutClientDevice: { findUnique: mocks.findDevice },
    user: { findUniqueOrThrow: mocks.findUser },
    scoutInteractiveRun: { findUnique: mocks.findRun },
  },
}));
// Explore access is the owner's servers; `desktop-routes.test.ts` covers how
// they are resolved. Here they are given, so the voice route is what runs.
vi.mock("#src/explore/access.ts", () => ({
  assertExploreAccess: mocks.exploreAccess,
}));
vi.mock("#src/configuration/flags.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  isPolicyEnabled: mocks.isPolicyEnabled,
}));
vi.mock("#src/explore/runs/run-manager.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  exploreRunManager: {
    start: mocks.startRun,
    subscribeDurable: mocks.subscribeRun,
    settleDurablePlaceholder: mocks.settleRun,
  },
}));
vi.mock(
  "@shepherdjerred/voice-assistant/openai-audio.ts",
  async (importOriginal) => ({
    ...(await importOriginal()),
    transcribeVoiceQuestion: mocks.transcribe,
    synthesizeVoiceAnswer: mocks.synthesize,
  }),
);
vi.mock("#src/explore/spending/ledger.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  exploreSpendingStatus: mocks.spendingStatus,
  recordExploreAudioSpend: mocks.recordAudio,
}));
vi.mock("#src/explore/store.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  loadExploreRunResult: mocks.loadResult,
  loadExploreTranscript: mocks.loadTranscript,
}));
vi.mock("#src/voice-assistant/runtime.ts", () => ({
  resolveVoiceCredential: mocks.voiceCredential,
}));

const { handleScoutClientRoute } = await import("#src/scout-client/http.ts");
const {
  resetDesktopReadRateLimitForTests,
  resetDesktopWriteRateLimitsForTests,
} = await import("./rate-limit.ts");
const { DESKTOP_WRITE_LIMITS_PER_MINUTE } = await import("./rate-limit.ts");
const { ExploreRunRateLimitedError } =
  await import("#src/explore/runs/run-manager.ts");

const TOKEN = `sct_${"a".repeat(43)}`;
const OWNER_ID = "160509172704739328";
const DEVICE_ID = "4fa2a856-53af-42a4-85af-5cc085a942a3";
const SHARED_GUILD = "111111111111111111";
const ORIGIN = "https://scout.invalid";
const VOICE_PATH = SCOUT_DESKTOP_API_ROUTES.coach_voice_turns.path;
const RUN = voiceFixture.response.events[1];

const RunSchema = z.strictObject({
  type: z.literal("run"),
  runId: z.uuid(),
  conversationId: z.uuid(),
  questionMessageId: z.uuid(),
});
const run = RunSchema.parse(RUN);
const complete = z
  .record(z.string(), z.unknown())
  .parse(coachFixtures.valid[0]?.body);

function voiceBody(overrides: Record<string, unknown> = {}) {
  return {
    trigger: "wake_word",
    conversationId: run.conversationId,
    audio: voiceFixture.request.audio,
    ...overrides,
  };
}

function voiceRequest(body: unknown): Request {
  return new Request(`${ORIGIN}${VOICE_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
      [SCOUT_DESKTOP_CONTRACT_HEADER]: String(SCOUT_DESKTOP_CONTRACT_VERSION),
    },
    body: JSON.stringify(body),
  });
}

async function send(body: unknown): Promise<Response> {
  const request = voiceRequest(body);
  const response = await handleScoutClientRoute(request, new URL(request.url));
  if (response === null) throw new Error("route was not handled");
  return response;
}

async function errorCode(response: Response) {
  return ScoutDesktopApiErrorSchema.parse(await response.json()).error;
}

/** Every event a stream carried, parsed against the contract. */
async function events(
  response: Response,
): Promise<ScoutDesktopVoiceTurnEvent[]> {
  expect(response.headers.get("Content-Type")).toContain("text/event-stream");
  const text = await response.text();
  return text
    .split("\n\n")
    .filter((frame) => frame.startsWith("event: "))
    .map((frame) => {
      const [eventLine, dataLine] = frame.split("\n");
      const event = ScoutDesktopVoiceTurnEventSchema.parse(
        JSON.parse(dataLine?.slice("data: ".length) ?? "null"),
      );
      expect(eventLine).toBe(`event: ${event.type}`);
      return event;
    });
}

/** Send a voice turn and read its stream to the end. */
async function drain(body: unknown): Promise<void> {
  const response = await send(body);
  await response.text();
}

function unsubscribe(): void {
  // The stand-in subscription holds nothing to release.
}

/** A durable subscription that reports the run done with `outcome`. */
function runEndingWith(outcome: string) {
  return async (
    _runId: string,
    _userId: string,
    subscriber: (event: unknown) => void,
  ) => {
    queueMicrotask(() => {
      subscriber({ type: "done", outcome });
    });
    return unsubscribe;
  };
}

/** Answer each named flag as given and every other flag on. */
function flags(values: Readonly<Record<string, boolean>>): void {
  mocks.isPolicyEnabled.mockImplementation(
    async (name: string) => values[name] ?? true,
  );
}

/** The coach record the route handed the run manager. */
function handedCoach(): unknown {
  const call = z
    .tuple([z.unknown(), z.unknown(), z.unknown(), z.looseObject({})])
    .parse(mocks.startRun.mock.calls[0]);
  return call[3]["coach"];
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDesktopReadRateLimitForTests();
  resetDesktopWriteRateLimitsForTests();
  flags({});
  mocks.findDevice.mockResolvedValue({
    id: DEVICE_ID,
    ownerId: OWNER_ID,
    appVersion: "0.5.0",
    deviceState: "ACTIVE",
    scopes: ["ingest", "explore"],
  });
  mocks.findUser.mockResolvedValue({
    discordId: OWNER_ID,
    discordUsername: "owner",
  });
  mocks.exploreAccess.mockResolvedValue([SHARED_GUILD]);
  mocks.voiceCredential.mockResolvedValue("sk-test-voice");
  mocks.spendingStatus.mockResolvedValue({
    userRemainingMicros: 1_000_000,
    globalRemainingMicros: 10_000_000,
  });
  mocks.recordAudio.mockResolvedValue(1);
  mocks.transcribe.mockResolvedValue("Hey Scout, what should I build next?");
  mocks.startRun.mockResolvedValue({
    runId: run.runId,
    conversationId: run.conversationId,
    questionMessageId: run.questionMessageId,
    leafIdAtStart: null,
    versionCountAtStart: 0,
    startedAt: "2026-11-14T09:12:30.000Z",
  });
  mocks.subscribeRun.mockImplementation(runEndingWith("succeeded"));
  mocks.loadResult.mockResolvedValue({
    answer: {
      id: "a1c3e5f7-0b2d-4f68-8a0c-2e4f6a8c0e13",
      content: "Build **Zhonya's**.",
    },
    spokenContent: "Build Zhonya's.",
  });
  mocks.synthesize.mockResolvedValue(new Uint8Array(48_000 * 2 + 10));
  mocks.findRun.mockResolvedValue({ lastError: null });
});

describe("coach/voice/turns admission", () => {
  test("refuses a request with no device credential before reading any audio", async () => {
    const request = new Request(`${ORIGIN}${VOICE_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [SCOUT_DESKTOP_CONTRACT_HEADER]: String(SCOUT_DESKTOP_CONTRACT_VERSION),
      },
      body: JSON.stringify(voiceBody()),
    });
    const response = await handleScoutClientRoute(
      request,
      new URL(request.url),
    );

    expect(response?.status).toBe(401);
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  test("a device paired without explore is refused", async () => {
    mocks.findDevice.mockResolvedValue({
      id: DEVICE_ID,
      ownerId: OWNER_ID,
      appVersion: "0.5.0",
      deviceState: "ACTIVE",
      scopes: ["ingest"],
    });

    const response = await send(voiceBody());

    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("scope_required");
  });

  test.each(["scout_desktop_voice", "scout_desktop_coach"])(
    "%s off refuses the route before any audio is transcribed",
    async (flag) => {
      flags({ [flag]: false });

      const response = await send(voiceBody());

      expect(response.status).toBe(503);
      expect(await errorCode(response)).toBe("feature_disabled");
      expect(mocks.transcribe).not.toHaveBeenCalled();
      expect(mocks.voiceCredential).not.toHaveBeenCalled();
    },
  );

  test("a typed question is not a voice turn", async () => {
    const response = await send(voiceBody({ question: "what do i build" }));

    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("invalid_request");
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  test("a body past the longest utterance is refused unread", async () => {
    const tooLong = "A".repeat(
      4 * Math.ceil((SCOUT_DESKTOP_VOICE_MAX_WAV_BYTES + 3) / 3),
    );
    const response = await send(
      voiceBody({ audio: { mediaType: "audio/wav", base64: tooLong } }),
    );

    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("invalid_request");
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  test("audio that is not a 16 kHz mono PCM WAV is refused", async () => {
    const wav = Buffer.from(voiceFixture.request.audio.base64, "base64");
    wav.writeUInt32LE(44_100, 24);

    const response = await send(
      voiceBody({
        audio: { mediaType: "audio/wav", base64: wav.toString("base64") },
      }),
    );

    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("invalid_request");
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  test("a context that breaks the coach contract is its own refusal", async () => {
    const response = await send(
      voiceBody({ gameContext: { live: { riotId: "someone#NA1" } } }),
    );

    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("invalid_game_context");
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  test("a deployment with no voice credential says so", async () => {
    mocks.voiceCredential.mockResolvedValue(undefined);

    const response = await send(voiceBody());

    expect(response.status).toBe(503);
    expect(await errorCode(response)).toBe("unavailable");
  });

  test("a device past its voice limit is refused before transcription", async () => {
    for (
      let index = 0;
      index < DESKTOP_WRITE_LIMITS_PER_MINUTE.voice;
      index += 1
    ) {
      await drain(voiceBody());
    }
    mocks.transcribe.mockClear();

    const response = await send(voiceBody());

    expect(response.status).toBe(429);
    expect(await errorCode(response)).toBe("rate_limited");
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });
});

describe("coach/voice/turns proof of initiation", () => {
  test("a wake-word turn the server verified runs as player_voice, phrase stripped", async () => {
    const response = await send(
      voiceBody({ gameContext: { live: complete["live"] } }),
    );

    expect(response.status).toBe(200);
    const stream = await events(response);
    expect(stream.map((event) => event.type)).toEqual([
      "transcript",
      "run",
      "answer",
      "audio",
      "audio",
      "audio",
      "done",
    ]);
    expect(stream[0]).toEqual({
      type: "transcript",
      text: "what should i build next",
      trigger: "wake_word",
      wake: "verified",
    });
    expect(mocks.startRun).toHaveBeenCalledWith(
      { userId: OWNER_ID },
      expect.objectContaining({ question: "what should i build next" }),
      [SHARED_GUILD],
      expect.objectContaining({ surface: "voice" }),
    );
    expect(handedCoach()).toEqual({
      deviceId: DEVICE_ID,
      initiation: "player_voice",
      gameKey: null,
      flags: { coachEnabled: true, liveAnswersEnabled: true },
      projection: {
        context: { live: complete["live"] },
        present: ["live"],
        accepted: ["live"],
        withheld: [],
      },
      voice: { trigger: "wake_word", wake: "verified" },
    });
    expect(stream.at(-1)).toEqual({ type: "done", outcome: "succeeded" });
    expect(mocks.settleRun).toHaveBeenCalledWith(run.runId, "succeeded");
  });

  test("a wake-word turn whose transcript lacks the phrase is refused and starts nothing", async () => {
    mocks.transcribe.mockResolvedValue("what should I build next?");

    const stream = await events(await send(voiceBody()));

    expect(stream).toEqual(voiceFixture.refusals[0]?.events);
    expect(mocks.startRun).not.toHaveBeenCalled();
    // The transcription was still spent, against no run.
    expect(mocks.recordAudio).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-4o-transcribe", audioMs: 200 }),
    );
  });

  test("the wake phrase alone is no question", async () => {
    mocks.transcribe.mockResolvedValue("Hey Scout.");

    const stream = await events(await send(voiceBody()));

    expect(stream.map((event) => event.type)).toEqual(["error", "done"]);
    expect(stream[0]).toMatchObject({ code: "empty_question" });
    expect(mocks.startRun).not.toHaveBeenCalled();
  });

  test("push-to-talk needs no phrase and keeps the whole transcript", async () => {
    mocks.transcribe.mockResolvedValue("How far ahead are we in gold?");

    const stream = await events(
      await send(voiceBody({ trigger: "push_to_talk" })),
    );

    expect(stream[0]).toEqual({
      type: "transcript",
      text: "How far ahead are we in gold?",
      trigger: "push_to_talk",
      wake: "not_required",
    });
    expect(handedCoach()).toMatchObject({
      initiation: "player_voice",
      voice: { trigger: "push_to_talk", wake: "not_required" },
    });
  });

  test.each([
    [{ coach: true, live: true }, ["live"]],
    [{ coach: true, live: false }, []],
  ])(
    "live on a spoken turn with %o reaches the agent as %o",
    async (values, accepted) => {
      flags({
        scout_desktop_coach: values.coach,
        scout_coach_live_answers: values.live,
      });

      await drain(voiceBody({ gameContext: { live: complete["live"] } }));

      expect(handedCoach()).toMatchObject({
        initiation: "player_voice",
        projection: { accepted },
      });
    },
  );

  test("a voice turn with no context still writes its audit record", async () => {
    await drain(voiceBody());

    expect(handedCoach()).toEqual({
      deviceId: DEVICE_ID,
      initiation: "player_voice",
      gameKey: null,
      flags: { coachEnabled: true, liveAnswersEnabled: true },
      projection: { context: null, present: [], accepted: [], withheld: [] },
      voice: { trigger: "wake_word", wake: "verified" },
    });
  });
});

describe("coach/voice/turns spend and refusals", () => {
  test("transcription and speech are booked against the run", async () => {
    await drain(voiceBody());

    expect(mocks.recordAudio).toHaveBeenCalledWith({
      ownerId: OWNER_ID,
      runId: run.runId,
      model: "gpt-4o-transcribe",
      audioMs: 200,
    });
    expect(mocks.recordAudio).toHaveBeenCalledWith({
      ownerId: OWNER_ID,
      runId: run.runId,
      model: "gpt-4o-mini-tts",
      audioMs: (48_000 * 2 + 10) / 48,
    });
  });

  test("a spent allowance refuses before the provider hears anything", async () => {
    mocks.spendingStatus.mockResolvedValue({
      userRemainingMicros: 0,
      globalRemainingMicros: 10_000_000,
    });

    const stream = await events(await send(voiceBody()));

    expect(stream.map((event) => event.type)).toEqual(["error", "done"]);
    expect(stream[0]).toMatchObject({ code: "budget_exhausted" });
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  test("a provider budget refusal is a typed budget event", async () => {
    mocks.transcribe.mockRejectedValue(
      Object.assign(new Error("Voice transcription failed with HTTP 429"), {
        code: "insufficient_quota",
      }),
    );

    const stream = await events(await send(voiceBody()));

    expect(stream).toEqual([
      expect.objectContaining({ type: "error", code: "budget_exhausted" }),
      { type: "done", outcome: "refused" },
    ]);
  });

  test("a spent in-game allowance is a quota event with its retry hint", async () => {
    mocks.startRun.mockRejectedValue(
      new ExploreRunRateLimitedError({
        allowed: false,
        quota: [],
        reason: "You have used 10 of 10 in-game questions for this minute.",
        retryAfterSeconds: 42,
      }),
    );
    mocks.transcribe.mockResolvedValue("How far ahead are we in gold?");

    const stream = await events(
      await send(voiceBody({ trigger: "push_to_talk" })),
    );

    expect(stream).toEqual(voiceFixture.refusals[1]?.events);
  });

  test("a run that ran out of budget ends with budget_exhausted", async () => {
    mocks.subscribeRun.mockImplementation(runEndingWith("failed"));
    mocks.findRun.mockResolvedValue({ lastError: "explore:budget_exceeded" });

    const stream = await events(await send(voiceBody()));

    expect(stream.slice(-2)).toEqual([
      expect.objectContaining({ type: "error", code: "budget_exhausted" }),
      { type: "done", outcome: "failed" },
    ]);
    expect(mocks.synthesize).not.toHaveBeenCalled();
  });

  test("speech that fails leaves the answer standing", async () => {
    mocks.synthesize.mockRejectedValue(
      new Error("Voice synthesis failed with HTTP 500"),
    );

    const stream = await events(await send(voiceBody()));

    expect(stream.map((event) => event.type)).toEqual([
      "transcript",
      "run",
      "answer",
      "error",
      "done",
    ]);
    expect(stream[3]).toMatchObject({ code: "synthesis_failed" });
    expect(stream.at(-1)).toEqual({ type: "done", outcome: "succeeded" });
  });
});

describe("the in-game answer's provenance by contract version", () => {
  const GET_PATH = SCOUT_DESKTOP_API_ROUTES.explore_conversations_get.path;
  const lowEffort = { model: "gpt-6-luna", reasoningEffort: "low" };

  test.each([
    ["7", null],
    ["8", lowEffort],
  ])("a version-%s client reads it as %o", async (version, generation) => {
    mocks.loadTranscript.mockResolvedValue({
      ...getFixture.response,
      messages: getFixture.response.messages.map((message) =>
        message.role === "assistant"
          ? { ...message, generation: lowEffort }
          : message,
      ),
    });
    const request = new Request(`${ORIGIN}${GET_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
        [SCOUT_DESKTOP_CONTRACT_HEADER]: version,
      },
      body: JSON.stringify({ conversationId: run.conversationId }),
    });
    const response = await handleScoutClientRoute(
      request,
      new URL(request.url),
    );

    const { messages } = ScoutDesktopConversationGetResponseSchema.parse(
      await response?.json(),
    );
    const answers = messages.filter((entry) => entry.role === "assistant");
    expect(answers.length).toBeGreaterThan(0);
    for (const answer of answers) {
      expect(answer.generation ?? null).toEqual(generation);
    }
  });
});
