import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  COACH_PROACTIVE_SPEECH_MAX_CHARACTERS,
  SCOUT_DESKTOP_API_ROUTES,
  SCOUT_DESKTOP_CONTRACT_HEADER,
  SCOUT_DESKTOP_VOICE_TURN,
  ScoutDesktopApiErrorSchema,
  ScoutDesktopCoachTriggerSpeechResponseSchema,
} from "@scout-for-lol/data";
import { z } from "zod";
import { resetConfigurationForTests } from "#src/configuration.ts";
import fixture from "@scout-for-lol/data/scout-client/desktop-fixtures/coach-triggers-speech.json" with { type: "json" };

/**
 * `coach/triggers/speech` against mocked storage and providers: production
 * refuses before anything is read, every flag a trigger needs plus voice is
 * required, only a succeeded proactive turn of the calling device is spoken,
 * and the audio allowance is held before the provider is called.
 */

const mocks = vi.hoisted(() => ({
  findDevice: vi.fn(),
  findUser: vi.fn(),
  findTurn: vi.fn(),
  exploreAccess: vi.fn(),
  isPolicyEnabled: vi.fn(),
  outcome: vi.fn(),
  loadResult: vi.fn(),
  voiceCredential: vi.fn(),
  synthesize: vi.fn(),
  reserveAudio: vi.fn(),
  settleAudio: vi.fn(),
  releaseAudio: vi.fn(),
}));

vi.mock("#src/database/index.ts", () => ({
  prisma: {
    scoutClientDevice: { findUnique: mocks.findDevice },
    user: { findUniqueOrThrow: mocks.findUser },
    scoutCoachTurn: { findUnique: mocks.findTurn },
  },
}));
// The owner's flags decide each case; Explore access is given (its rules are
// `desktop-routes.test.ts`'s) and so is the web origin.
vi.mock("#src/configuration/flags.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  isPolicyEnabled: mocks.isPolicyEnabled,
}));
vi.mock("#src/trpc/auth-web-helpers.ts", () => ({
  getAppOrigin: () => "https://scout.invalid",
}));
vi.mock("#src/explore/access.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  assertExploreAccess: mocks.exploreAccess,
}));
vi.mock("#src/explore/runs/durable-runs.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  durableExploreOutcome: mocks.outcome,
}));
vi.mock("#src/explore/store.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  loadExploreRunResult: mocks.loadResult,
}));
vi.mock("#src/voice-assistant/runtime.ts", () => ({
  resolveVoiceCredential: mocks.voiceCredential,
}));
vi.mock(
  "@shepherdjerred/voice-assistant/openai-audio.ts",
  async (importOriginal) => ({
    ...(await importOriginal()),
    synthesizeVoiceAnswer: mocks.synthesize,
  }),
);
vi.mock("#src/explore/spending/ledger.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  reserveExploreAudio: mocks.reserveAudio,
  settleExploreAudio: mocks.settleAudio,
  releaseExploreAudio: mocks.releaseAudio,
}));

const { handleScoutClientRoute } = await import("#src/scout-client/http.ts");
const {
  resetDesktopReadRateLimitForTests,
  resetDesktopWriteRateLimitsForTests,
} = await import("./rate-limit.ts");
const { ExploreBudgetError } = await import("#src/explore/spending/ledger.ts");

const TOKEN = `sct_${"a".repeat(43)}`;
const OWNER_ID = "160509172704739328";
const DEVICE_ID = "4fa2a856-53af-42a4-85af-5cc085a942a3";
const OTHER_DEVICE_ID = "9d1c4e1a-7b55-4b0a-9f0e-2a6c3d8e1f42";
const SHARED_GUILD = "111111111111111111";
const ORIGIN = "https://scout.invalid";
const PATH = SCOUT_DESKTOP_API_ROUTES.coach_triggers_speech.path;
const CONVERSATION_ID = "5d2a7c90-3e41-4b8f-a6d5-1c9e0f8b7a23";
const FLAGS = [
  "scout_desktop_coach",
  "scout_coach_live_answers",
  "scout_coach_proactive",
  "scout_desktop_voice",
] as const;
const FlagSchema = z.enum(FLAGS);
type Flag = z.infer<typeof FlagSchema>;
const ORIGINAL_ENV = {
  ENVIRONMENT: Bun.env["ENVIRONMENT"],
  EXPLORE_GUILD_ALLOWLIST: Bun.env["EXPLORE_GUILD_ALLOWLIST"],
};
/** One second of speech: 24 kHz, 16-bit mono. */
const SPEECH = new Uint8Array(48_000 + 2);

async function send(body: unknown): Promise<Response> {
  const req = new Request(`${ORIGIN}${PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
      [SCOUT_DESKTOP_CONTRACT_HEADER]: "11",
    },
    body: JSON.stringify(body),
  });
  const response = await handleScoutClientRoute(req, new URL(req.url));
  if (response === null) throw new Error("route was not handled");
  return response;
}

async function errorCode(response: Response) {
  return ScoutDesktopApiErrorSchema.parse(await response.json()).error;
}

/** Every flag on except the ones this names. */
function flags(values: Partial<Record<Flag, boolean>>): void {
  mocks.isPolicyEnabled.mockImplementation((name: string) => {
    const flag = FlagSchema.safeParse(name);
    return Promise.resolve(flag.success ? (values[flag.data] ?? true) : true);
  });
}

function flagReads(): string[] {
  return mocks.isPolicyEnabled.mock.calls
    .map(([name]: unknown[]) => z.string().parse(name))
    .filter((name) => FlagSchema.safeParse(name).success);
}

function useEnvironment(environment: "dev" | "beta" | "prod"): void {
  Bun.env["ENVIRONMENT"] = environment;
  resetConfigurationForTests();
}

/** Nothing past the gate ran: no storage read, no provider, no spend. */
function expectNothingRead(): void {
  expect(mocks.findTurn).not.toHaveBeenCalled();
  expect(mocks.loadResult).not.toHaveBeenCalled();
  expect(mocks.reserveAudio).not.toHaveBeenCalled();
  expect(mocks.synthesize).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  useEnvironment("beta");
  Bun.env["EXPLORE_GUILD_ALLOWLIST"] = SHARED_GUILD;
  resetConfigurationForTests();
  resetDesktopReadRateLimitForTests();
  resetDesktopWriteRateLimitsForTests();
  flags({});
  mocks.findDevice.mockResolvedValue({
    id: DEVICE_ID,
    ownerId: OWNER_ID,
    appVersion: "0.4.0",
    deviceState: "ACTIVE",
    scopes: ["ingest", "explore"],
  });
  mocks.findUser.mockResolvedValue({ discordId: OWNER_ID });
  mocks.exploreAccess.mockResolvedValue([SHARED_GUILD]);
  mocks.findTurn.mockResolvedValue({
    ownerId: OWNER_ID,
    deviceId: DEVICE_ID,
    conversationId: CONVERSATION_ID,
    initiation: "app_proactive",
  });
  mocks.outcome.mockResolvedValue("succeeded");
  mocks.loadResult.mockResolvedValue({
    answer: {
      id: fixture.response.messageId,
      content: `**${fixture.response.spokenText}**`,
    },
    spokenContent: null,
  });
  mocks.voiceCredential.mockResolvedValue("sk-test-voice");
  mocks.reserveAudio.mockImplementation(
    (input: { model: string; audioMs: number }) =>
      Promise.resolve({ id: "hold", model: input.model, amount: 1 }),
  );
  mocks.settleAudio.mockResolvedValue(undefined);
  mocks.releaseAudio.mockResolvedValue(undefined);
  mocks.synthesize.mockResolvedValue(SPEECH);
});

afterAll(() => {
  for (const [name, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) Reflect.deleteProperty(Bun.env, name);
    else Bun.env[name] = value;
  }
  resetConfigurationForTests();
});

describe("coach/triggers/speech in production", () => {
  test("no flag state speaks, and nothing is read before the refusal", async () => {
    useEnvironment("prod");
    for (const values of [
      {},
      Object.fromEntries(FLAGS.map((flag) => [flag, true])),
      Object.fromEntries(FLAGS.map((flag) => [flag, false])),
    ]) {
      flags(values);
      const response = await send(fixture.request);
      expect(response.status).toBe(503);
      expect(await errorCode(response)).toBe("feature_disabled");
    }
    for (const { body } of fixture.invalidRequests) {
      const response = await send(body);
      expect(await errorCode(response)).toBe("feature_disabled");
    }
    expect(flagReads()).toEqual([]);
    expectNothingRead();
  });
});

describe("coach/triggers/speech outside production", () => {
  test("a succeeded proactive turn of this device is spoken from its saved answer", async () => {
    const response = await send(fixture.request);

    expect(response.status).toBe(200);
    const body = ScoutDesktopCoachTriggerSpeechResponseSchema.parse(
      await response.json(),
    );
    expect(body.messageId).toBe(fixture.response.messageId);
    // The saved answer, without the Markdown a voice would read aloud.
    expect(body.spokenText).toBe(fixture.response.spokenText);
    expect(body.encoding).toBe(SCOUT_DESKTOP_VOICE_TURN.speech.encoding);
    expect(
      body.chunks.map((chunk) => Buffer.from(chunk, "base64").length),
    ).toEqual([SCOUT_DESKTOP_VOICE_TURN.speech.maxChunkBytes, 2]);
    expect(mocks.findTurn).toHaveBeenCalledWith(
      expect.objectContaining({ where: { runId: fixture.request.runId } }),
    );
    expect(mocks.synthesize).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "sk-test-voice",
        text: fixture.response.spokenText,
      }),
    );
  });

  test("the allowance is held before the provider speaks and settled at the speech's length", async () => {
    const order: string[] = [];
    mocks.reserveAudio.mockImplementation((input: { audioMs: number }) => {
      order.push(`hold ${input.audioMs.toString()}`);
      return Promise.resolve({ id: "hold", model: "tts", amount: 1 });
    });
    mocks.synthesize.mockImplementation(() => {
      order.push("speak");
      return Promise.resolve(SPEECH);
    });
    await send(fixture.request);
    expect(order).toEqual([
      `hold ${(fixture.response.spokenText.length * 100).toString()}`,
      "speak",
    ]);
    expect(mocks.settleAudio).toHaveBeenCalledWith(
      expect.objectContaining({ id: "hold" }),
      { audioMs: SPEECH.byteLength / 48, runId: fixture.request.runId },
    );
  });

  test.each(FLAGS)("%s off refuses before any run is read", async (flag) => {
    flags({ [flag]: false });
    const response = await send(fixture.request);
    expect(response.status).toBe(503);
    expect(await errorCode(response)).toBe("feature_disabled");
    expectNothingRead();
  });

  test("the body names a run and nothing else", async () => {
    for (const { reason, body } of fixture.invalidRequests) {
      const response = await send(body);
      expect(response.status, reason).toBe(400);
      expect(await errorCode(response), reason).toBe("invalid_request");
    }
    expectNothingRead();
  });

  test.each([
    ["another owner's turn", { ownerId: "222222222222222222" }],
    ["another device's turn", { deviceId: OTHER_DEVICE_ID }],
    ["a turn the player asked", { initiation: "player_typed" }],
    ["a champion-select turn", { initiation: "app_champ_select" }],
  ])("%s is not found", async (_name, override) => {
    mocks.findTurn.mockResolvedValue({
      ownerId: OWNER_ID,
      deviceId: DEVICE_ID,
      conversationId: CONVERSATION_ID,
      initiation: "app_proactive",
      ...override,
    });
    const response = await send(fixture.request);
    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe("not_found");
    expect(mocks.synthesize).not.toHaveBeenCalled();
  });

  test("an unknown run is not found", async () => {
    mocks.findTurn.mockResolvedValue(null);
    expect(await errorCode(await send(fixture.request))).toBe("not_found");
    expect(mocks.synthesize).not.toHaveBeenCalled();
  });

  test.each([null, "failed", "stopped"])(
    "a turn whose run is %s has nothing to speak",
    async (outcome) => {
      mocks.outcome.mockResolvedValue(outcome);
      const response = await send(fixture.request);
      expect(response.status).toBe(400);
      expect(await errorCode(response)).toBe("invalid_turn");
      expect(mocks.reserveAudio).not.toHaveBeenCalled();
    },
  );

  test("an answer too long to speak is refused before any spend", async () => {
    mocks.loadResult.mockResolvedValue({
      answer: {
        id: fixture.response.messageId,
        content: "a".repeat(COACH_PROACTIVE_SPEECH_MAX_CHARACTERS + 1),
      },
      spokenContent: null,
    });
    expect(await errorCode(await send(fixture.request))).toBe("invalid_turn");
    expect(mocks.reserveAudio).not.toHaveBeenCalled();
  });

  test("a spent allowance is refused without calling the provider", async () => {
    mocks.reserveAudio.mockRejectedValue(new ExploreBudgetError());
    const response = await send(fixture.request);
    expect(response.status).toBe(429);
    expect(await errorCode(response)).toBe("quota_exceeded");
    expect(mocks.synthesize).not.toHaveBeenCalled();
  });

  test("a failed synthesis gives the hold back and says so", async () => {
    mocks.synthesize.mockRejectedValue(new Error("provider down"));
    const response = await send(fixture.request);
    expect(response.status).toBe(503);
    expect(await errorCode(response)).toBe("unavailable");
    expect(mocks.releaseAudio).toHaveBeenCalled();
    expect(mocks.settleAudio).not.toHaveBeenCalled();
  });

  test("a server with no voice credential is unavailable, before any spend", async () => {
    mocks.voiceCredential.mockResolvedValue(undefined);
    expect(await errorCode(await send(fixture.request))).toBe("unavailable");
    expect(mocks.reserveAudio).not.toHaveBeenCalled();
  });
});
