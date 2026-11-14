/**
 * Scout Desktop's Explore run routes against a real database and the real
 * run manager, the same one the web's tRPC procedures use.
 *
 * The manager runs inline with a controlled agent, so a test decides when an
 * answer streams and finishes. Everything else (device auth, Explore access,
 * the per-user turn limits, persistence and the SSE writer) is the
 * production code path.
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
  ExploreActiveRunSchema,
  ExploreAnswerSchema,
  ExploreRunOutcomeResultSchema,
  ExploreStreamEventSchema,
  SCOUT_DESKTOP_API_ROUTES,
  SCOUT_DESKTOP_CONTRACT_HEADER,
  SCOUT_DESKTOP_CONTRACT_VERSION,
  ScoutDesktopApiErrorSchema,
  ScoutDesktopRunActiveResponseSchema,
  type ExploreStreamEvent,
  type ScoutDesktopScope,
} from "@scout-for-lol/data";
import type * as RunManagerModule from "#src/explore/runs/run-manager.ts";
import type { ExploreAgentRunner } from "#src/explore/runs/run-manager-types.ts";
import type { ExploreAgentParams } from "#src/explore/analysis/agent-types.ts";
import type { ExploreAgentResult } from "#src/explore/agent.ts";
import { resetConfigurationForTests } from "#src/configuration.ts";
import { secretDigest } from "#src/scout-client/secrets.ts";
import { createTestScoutClientDevice } from "#src/testing/scout-client/scout-client-device.ts";
import { createOfflineTrpcHarness } from "#src/testing/test-trpc-caller.ts";

type ControlledRun = {
  readonly params: ExploreAgentParams;
  readonly resolve: (result: ExploreAgentResult) => void;
};
const runs: ControlledRun[] = [];
const runAgent: ExploreAgentRunner = async (params) =>
  await new Promise<ExploreAgentResult>((resolve, reject) => {
    runs.push({ params, resolve });
    params.abortSignal.addEventListener(
      "abort",
      () => {
        reject(new Error("Explore test run aborted."));
      },
      { once: true },
    );
  });

const managers: RunManagerModule.ExploreRunManager[] = [];
vi.doMock("#src/explore/runs/run-manager.ts", async (importOriginal) => {
  const original = await importOriginal<typeof RunManagerModule>();
  const manager = new original.ExploreRunManager({
    runAgent,
    inlineExecutionForTests: true,
  });
  managers.push(manager);
  return { ...original, exploreRunManager: manager };
});

const trpc = await createOfflineTrpcHarness(
  "scout-client-desktop-explore-runs",
);
const { handleScoutClientRoute } = await import("#src/scout-client/http.ts");
const { resetDesktopReadRateLimitForTests } = await import("./rate-limit.ts");
const { resetDesktopStreamSlotsForTests } =
  await import("./explore-run-routes.ts");
const { resetExploreRateLimitStateForTests } =
  await import("#src/explore/rate-limit.ts");

const OWNER = DiscordAccountIdSchema.parse("900000000000009601");
const GUILD = DiscordGuildIdSchema.parse("100000000000009601");
const ORIGIN = "https://scout.invalid";
const QUESTION = {
  conversationId: null,
  question: "Who carries our ARAMs?",
  attach: { kind: "leaf" },
} as const;
const originalEnvironment = Bun.env["ENVIRONMENT"];
const originalAllowlist = Bun.env["EXPLORE_GUILD_ALLOWLIST"];

const ROUTES = SCOUT_DESKTOP_API_ROUTES;

function runManager(): RunManagerModule.ExploreRunManager {
  const found = managers[0];
  if (found === undefined) throw new Error("the run manager was not built");
  return found;
}

function successfulResult(answer: string): ExploreAgentResult {
  return {
    answer: ExploreAnswerSchema.parse({ answer }),
    preview: null,
    visualization: null,
    matchCards: [],
    loadoutCards: [],
  };
}

async function agentRun(index: number): Promise<ControlledRun> {
  return await vi.waitFor(() => {
    const run = runs[index];
    if (run === undefined)
      throw new Error(`run ${index.toString()} not started`);
    return run;
  });
}

/** An active device of the owner's, and the bearer token it signs in with. */
async function deviceToken(
  scopes: readonly ScoutDesktopScope[] = ["ingest", "explore"],
): Promise<string> {
  const token = `sct_${(scopes.length === 2 ? "a" : "b").repeat(43)}`;
  await createTestScoutClientDevice(trpc.prisma, OWNER, {
    tokenDigest: secretDigest(token),
    scopes,
  });
  return token;
}

function deviceHeaders(token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    [SCOUT_DESKTOP_CONTRACT_HEADER]: String(SCOUT_DESKTOP_CONTRACT_VERSION),
  };
}

async function post(
  path: string,
  token: string,
  body: unknown = {},
): Promise<Response> {
  const url = new URL(path, ORIGIN);
  const response = await handleScoutClientRoute(
    new Request(url.href, {
      method: "POST",
      headers: deviceHeaders(token),
      body: JSON.stringify(body),
    }),
    url,
  );
  if (response === null) throw new Error(`${path} was not handled`);
  return response;
}

async function refusal(response: Response) {
  const body = ScoutDesktopApiErrorSchema.parse(await response.json());
  return body.error;
}

async function startRun(token: string) {
  const response = await post(ROUTES.explore_runs_start.path, token, QUESTION);
  expect(response.status).toBe(200);
  return ExploreActiveRunSchema.parse(await response.json());
}

/** Every frame of a finished SSE body. */
function parseFrames(text: string): ExploreStreamEvent[] {
  return text
    .split("\n\n")
    .filter((block) => block.trim().length > 0)
    .map((block) => {
      const data = block
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice("data: ".length);
      if (data === undefined) throw new Error(`frame without data: ${block}`);
      return ExploreStreamEventSchema.parse(JSON.parse(data));
    });
}

beforeEach(async () => {
  Bun.env["ENVIRONMENT"] = "beta";
  Bun.env["EXPLORE_GUILD_ALLOWLIST"] = GUILD;
  resetConfigurationForTests();
  resetDesktopReadRateLimitForTests();
  resetDesktopStreamSlotsForTests();
  resetExploreRateLimitStateForTests();
  trpc.setMembership([{ guildId: GUILD, asAdmin: false }]);
  runs.length = 0;
  await trpc.prisma.exploreMessage.deleteMany();
  await trpc.prisma.exploreConversation.deleteMany();
  await trpc.prisma.scoutClientDeviceVersion.deleteMany();
  await trpc.prisma.scoutClientDevice.deleteMany();
  await trpc.prisma.scoutClientPairing.deleteMany();
  await trpc.prisma.user.upsert({
    where: { discordId: OWNER },
    create: { discordId: OWNER, discordUsername: "owner" },
    update: {},
  });
});

afterEach(async () => {
  // Settle whatever a test left running, so the next starts with no run.
  for (const run of runs) run.resolve(successfulResult("Settled."));
  await vi.waitFor(() => {
    expect(runManager().list(OWNER)).toEqual([]);
  });
});

afterAll(async () => {
  await runManager().shutdown();
  if (originalEnvironment === undefined) delete Bun.env["ENVIRONMENT"];
  else Bun.env["ENVIRONMENT"] = originalEnvironment;
  if (originalAllowlist === undefined) {
    delete Bun.env["EXPLORE_GUILD_ALLOWLIST"];
  } else {
    Bun.env["EXPLORE_GUILD_ALLOWLIST"] = originalAllowlist;
  }
  resetConfigurationForTests();
  await trpc.prisma.$disconnect();
});

describe("desktop Explore runs against a real database", () => {
  test("a desktop turn streams from a snapshot, survives a reconnect and lands as a desktop conversation", async () => {
    const token = await deviceToken();
    const summary = await startRun(token);
    const run = await agentRun(0);
    await run.params.emit({ type: "answer_delta", text: "Jinx " });

    // The first observer attaches, sees the answer so far, and drops.
    const first = await post(ROUTES.explore_runs_stream.path, token, {
      runId: summary.runId,
    });
    expect(first.status).toBe(200);
    if (first.body === null) throw new Error("stream has no body");
    const reader = first.body.getReader();
    const chunk = await reader.read();
    const opening = new TextDecoder().decode(chunk.value);
    expect(opening.startsWith("event: snapshot\n")).toBe(true);
    expect(opening).toContain('"answer":"Jinx "');
    await reader.cancel();

    await run.params.emit({ type: "answer_delta", text: "wins." });

    // The reconnect replaces state from a whole snapshot, then streams on.
    const second = await post(ROUTES.explore_runs_stream.path, token, {
      runId: summary.runId,
    });
    expect(second.status).toBe(200);
    run.resolve(successfulResult("Jinx wins."));
    const events = parseFrames(await second.text());

    expect(events[0]).toMatchObject({
      type: "snapshot",
      runId: summary.runId,
      answer: "Jinx wins.",
    });
    expect(events.at(-1)).toEqual({ type: "done", outcome: "succeeded" });
    expect(events.some((event) => event.type === "final")).toBe(true);

    const conversation =
      await trpc.prisma.exploreConversation.findUniqueOrThrow({
        where: { id: summary.conversationId },
      });
    expect(conversation.origin).toBe("desktop");
    expect(conversation.userId).toBe(OWNER);

    const outcome = await post(ROUTES.explore_runs_outcome.path, token, {
      runId: summary.runId,
    });
    expect(ExploreRunOutcomeResultSchema.parse(await outcome.json())).toEqual({
      outcome: "succeeded",
    });
  });

  test("stopping a desktop run ends its stream as stopped", async () => {
    const token = await deviceToken();
    const summary = await startRun(token);
    await agentRun(0);

    const active = await post(ROUTES.explore_runs_active.path, token);
    expect(
      ScoutDesktopRunActiveResponseSchema.parse(await active.json()).runs,
    ).toEqual([summary]);

    const stream = await post(ROUTES.explore_runs_stream.path, token, {
      runId: summary.runId,
    });
    const stopped = await post(ROUTES.explore_runs_stop.path, token, {
      runId: summary.runId,
    });
    expect(stopped.status).toBe(200);
    expect(await stopped.json()).toEqual({ ok: true });

    const events = parseFrames(await stream.text());
    expect(events.at(-1)).toEqual({ type: "done", outcome: "stopped" });
    const after = await post(ROUTES.explore_runs_active.path, token);
    expect(
      ScoutDesktopRunActiveResponseSchema.parse(await after.json()).runs,
    ).toEqual([]);
  });

  test("the owner's web and desktop turns share one Explore allowance", async () => {
    const token = await deviceToken();
    const web = trpc.authedCaller(OWNER);
    await web.explore.start(QUESTION);
    await agentRun(0);

    const held = await post(ROUTES.explore_runs_start.path, token, QUESTION);
    expect(held.status).toBe(429);
    expect(await refusal(held)).toBe("quota_exceeded");

    runs[0]?.resolve(successfulResult("Web answer."));
    await vi.waitFor(() => {
      expect(runManager().list(OWNER)).toEqual([]);
    });
    await startRun(token);
    await agentRun(1);

    await expect(web.explore.start(QUESTION)).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
  });

  test("a device without the explore scope cannot start a turn", async () => {
    const token = await deviceToken(["ingest"]);

    const response = await post(
      ROUTES.explore_runs_start.path,
      token,
      QUESTION,
    );

    expect(response.status).toBe(403);
    expect(await refusal(response)).toBe("scope_required");
    expect(runs).toHaveLength(0);
  });
});

async function desktopConversation(): Promise<string> {
  const conversation = await trpc.prisma.exploreConversation.create({
    data: {
      userId: OWNER,
      title: "Asked from Scout Desktop",
      origin: "desktop",
    },
  });
  return conversation.id;
}

describe("the desktop origin in browsers", () => {
  test.each([
    [undefined, "web"],
    [3, "web"],
    [4, "web"],
    [5, "desktop"],
  ] as const)("a version-%s bundle reads it as %s", async (version, origin) => {
    const conversationId = await desktopConversation();

    const transcript = await trpc
      .authedCaller(OWNER)
      .explore.get(
        version === undefined
          ? { conversationId }
          : { conversationId, version },
      );

    expect(transcript.conversation.origin).toBe(origin);
  });

  test("the database refuses an origin outside the enum", async () => {
    const conversationId = await desktopConversation();

    await expect(
      trpc.prisma
        .$executeRaw`UPDATE "ExploreConversation" SET "origin" = 'mobile' WHERE "id" = ${conversationId}`,
    ).rejects.toThrow();
  });
});
