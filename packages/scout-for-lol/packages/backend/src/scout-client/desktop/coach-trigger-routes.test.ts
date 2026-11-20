import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  SCOUT_DESKTOP_API_ROUTES,
  SCOUT_DESKTOP_CONTRACT_HEADER,
  CoachGameContextSchema,
  ScoutDesktopApiErrorSchema,
  ScoutDesktopCoachTriggerResponseSchema,
} from "@scout-for-lol/data";
import { z } from "zod";
import { resetConfigurationForTests } from "#src/configuration.ts";
import fixture from "@scout-for-lol/data/scout-client/desktop-fixtures/coach-triggers.json" with { type: "json" };

const mocks = vi.hoisted(() => ({
  findDevice: vi.fn(),
  findUser: vi.fn(),
  isPolicyEnabled: vi.fn(),
  startRun: vi.fn(),
}));

vi.mock("#src/database/index.ts", () => ({
  prisma: {
    scoutClientDevice: { findUnique: mocks.findDevice },
    user: { findUniqueOrThrow: mocks.findUser },
  },
}));
// Explore access resolves servers differently per environment; this file is
// about what happens after a device is let in, in every environment.
vi.mock("#src/explore/access.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  assertExploreAccess: () => Promise.resolve(["111111111111111111"]),
}));
vi.mock("#src/configuration/flags.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  isPolicyEnabled: mocks.isPolicyEnabled,
}));
vi.mock("#src/trpc/auth-web-helpers.ts", () => ({
  getAppOrigin: () => "https://scout.invalid",
}));
vi.mock("#src/explore/runs/run-manager.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  exploreRunManager: { start: mocks.startRun },
}));

const { coachRunSettings } = await import("#src/coach/execution-profile.ts");
const { handleScoutClientRoute } = await import("#src/scout-client/http.ts");
const { resetDesktopReadRateLimitForTests } = await import("./rate-limit.ts");
const { ProactiveTriggerRefusedError } =
  await import("#src/coach/proactive-triggers.ts");

const TOKEN = `sct_${"a".repeat(43)}`;
const OWNER_ID = "160509172704739328";
const DEVICE_ID = "4fa2a856-53af-42a4-85af-5cc085a942a3";
const SHARED_GUILD = "111111111111111111";
const ORIGIN = "https://scout.invalid";
const PATH = SCOUT_DESKTOP_API_ROUTES.coach_triggers.path;
const COACH_FLAGS = [
  "scout_desktop_coach",
  "scout_coach_live_answers",
  "scout_coach_proactive",
] as const;
const CoachFlagSchema = z.enum(COACH_FLAGS);
type CoachFlag = z.infer<typeof CoachFlagSchema>;
const ORIGINAL_ENV = {
  ENVIRONMENT: Bun.env["ENVIRONMENT"],
  EXPLORE_GUILD_ALLOWLIST: Bun.env["EXPLORE_GUILD_ALLOWLIST"],
};

function request(body: unknown): Request {
  return new Request(`${ORIGIN}${PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
      [SCOUT_DESKTOP_CONTRACT_HEADER]: "8",
    },
    body: JSON.stringify(body),
  });
}

async function send(body: unknown): Promise<Response> {
  const req = request(body);
  const response = await handleScoutClientRoute(req, new URL(req.url));
  if (response === null) throw new Error("route was not handled");
  return response;
}

async function errorCode(response: Response) {
  return ScoutDesktopApiErrorSchema.parse(await response.json()).error;
}

/** Every flag on except the coach flags this names. */
function coachFlags(values: Partial<Record<CoachFlag, boolean>>): void {
  mocks.isPolicyEnabled.mockImplementation((name: string) => {
    const flag = CoachFlagSchema.safeParse(name);
    return Promise.resolve(flag.success ? (values[flag.data] ?? true) : true);
  });
}

function coachFlagReads(): string[] {
  return mocks.isPolicyEnabled.mock.calls
    .map(([name]: unknown[]) => z.string().parse(name))
    .filter((name) => CoachFlagSchema.safeParse(name).success);
}

function useEnvironment(environment: "dev" | "beta" | "prod"): void {
  Bun.env["ENVIRONMENT"] = environment;
  resetConfigurationForTests();
}

/** Every combination of the three coach flags. */
const EVERY_FLAG_STATE = [false, true].flatMap((coach) =>
  [false, true].flatMap((live) =>
    [false, true].map((proactive) => ({
      scout_desktop_coach: coach,
      scout_coach_live_answers: live,
      scout_coach_proactive: proactive,
    })),
  ),
);

beforeEach(() => {
  vi.clearAllMocks();
  useEnvironment("beta");
  Bun.env["EXPLORE_GUILD_ALLOWLIST"] = SHARED_GUILD;
  resetConfigurationForTests();
  resetDesktopReadRateLimitForTests();
  coachFlags({});
  mocks.findDevice.mockResolvedValue({
    id: DEVICE_ID,
    ownerId: OWNER_ID,
    appVersion: "0.4.0",
    deviceState: "ACTIVE",
    scopes: ["ingest", "explore"],
  });
  mocks.findUser.mockResolvedValue({ discordId: OWNER_ID });
  mocks.startRun.mockResolvedValue(fixture.response.run);
});

afterAll(() => {
  for (const [name, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) Reflect.deleteProperty(Bun.env, name);
    else Bun.env[name] = value;
  }
  resetConfigurationForTests();
});

describe("coach/triggers in production", () => {
  test("no flag state admits a proactive turn, and no coach flag is read", async () => {
    useEnvironment("prod");
    for (const values of EVERY_FLAG_STATE) {
      coachFlags(values);
      const response = await send(fixture.request);
      expect(response.status, JSON.stringify(values)).toBe(503);
      expect(await errorCode(response)).toBe("feature_disabled");
    }
    expect(mocks.startRun).not.toHaveBeenCalled();
    expect(coachFlagReads()).toEqual([]);
  });

  test("a body is refused as disabled before it is read", async () => {
    useEnvironment("prod");
    for (const { body } of fixture.invalidRequests) {
      const response = await send(body);
      expect(response.status).toBe(503);
      expect(await errorCode(response)).toBe("feature_disabled");
    }
    expect(mocks.startRun).not.toHaveBeenCalled();
  });
});

describe("coach/triggers outside production", () => {
  test("a trigger with every flag on starts a proactive turn the server worded", async () => {
    const response = await send(fixture.request);

    expect(response.status).toBe(200);
    expect(
      ScoutDesktopCoachTriggerResponseSchema.parse(await response.json()),
    ).toEqual(fixture.response);
    const [identity, turn, , context] = z
      .tuple([
        z.looseObject({ userId: z.string() }),
        z.looseObject({ question: z.string(), conversationId: z.null() }),
        z.unknown(),
        z.looseObject({ surface: z.string(), coach: z.looseObject({}) }),
      ])
      .parse(mocks.startRun.mock.calls[0]);
    expect(identity.userId).toBe(OWNER_ID);
    expect(turn.question).toBe(
      "Scout noticed the enemy Zed completed Eclipse. What, if anything, should I consider?",
    );
    expect(context.surface).toBe("desktop");
    expect(context.coach).toMatchObject({
      deviceId: DEVICE_ID,
      initiation: "app_proactive",
      gameKey: fixture.request.gameKey,
      flags: {
        coachEnabled: true,
        liveAnswersEnabled: true,
        proactiveEnabled: true,
      },
      projection: { present: ["live"], accepted: ["live"], withheld: [] },
      trigger: { kind: "enemy_item_spike", windowKey: "Zed:6692" },
    });
    expect(coachFlagReads().toSorted()).toEqual([...COACH_FLAGS].toSorted());
  });

  test("a proactive turn runs the in-game profile and spends the in-game allowance", async () => {
    await send(fixture.request);
    const { projection } = z
      .object({
        projection: z.object({ context: CoachGameContextSchema }),
      })
      .parse(
        z
          .object({ coach: z.unknown() })
          .parse(
            z
              .tuple([z.unknown(), z.unknown(), z.unknown(), z.unknown()])
              .parse(mocks.startRun.mock.calls[0])[3],
          ).coach,
      );
    expect(coachRunSettings(projection.context)).toMatchObject({
      quota: "in_game",
      reasoningEffort: "low",
    });
  });

  test.each(["dev", "beta"] as const)(
    "%s admits only with all three coach flags on",
    async (environment) => {
      useEnvironment(environment);
      for (const values of EVERY_FLAG_STATE) {
        coachFlags(values);
        mocks.startRun.mockClear();
        const response = await send(fixture.request);
        const admitted = Object.values(values).every(Boolean);
        expect(response.status, JSON.stringify(values)).toBe(
          admitted ? 200 : 503,
        );
        expect(mocks.startRun).toHaveBeenCalledTimes(admitted ? 1 : 0);
      }
    },
  );

  test.each(fixture.invalidRequests)(
    "refuses $reason before any run",
    async ({ body }) => {
      const response = await send(body);
      expect(response.status).toBe(400);
      expect(mocks.startRun).not.toHaveBeenCalled();
    },
  );

  test("evidence that does not match its snapshot is invalid_game_context", async () => {
    const response = await send({
      ...fixture.request,
      trigger: { ...fixture.request.trigger, champion: "Garen" },
    });
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("invalid_game_context");
    expect(mocks.startRun).not.toHaveBeenCalled();
  });

  test("a duplicate event answers duplicate and starts nothing", async () => {
    mocks.startRun.mockRejectedValue(
      new ProactiveTriggerRefusedError({ kind: "duplicate" }),
    );
    const response = await send(fixture.request);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(fixture.duplicateResponse);
  });

  test("a full game is rate_limited", async () => {
    mocks.startRun.mockRejectedValue(
      new ProactiveTriggerRefusedError({ kind: "game_cap", limit: 10 }),
    );
    const response = await send(fixture.request);
    expect(response.status).toBe(429);
    expect(await errorCode(response)).toBe("rate_limited");
  });

  test("a trigger too soon is rate_limited with the wait left", async () => {
    mocks.startRun.mockRejectedValue(
      new ProactiveTriggerRefusedError({
        kind: "spacing",
        retryAfterSeconds: 42,
      }),
    );
    const response = await send(fixture.request);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
    expect(await errorCode(response)).toBe("rate_limited");
  });
});
