import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import type { ReportQueryAgentParams } from "#src/reports/ai/report-query-agent.ts";
import type { ExploreAgentParams } from "#src/explore/agent-tools.ts";

const reportAiProvider = vi.hoisted(() => ({ calls: 0 }));
const exploreProvider = vi.hoisted(
  (): { calls: number; gate: Promise<null> | null } => ({
    calls: 0,
    gate: null,
  }),
);
vi.mock("#src/reports/ai/report-query-agent.ts", () => ({
  streamReportQueryAgent: async (params: ReportQueryAgentParams) => {
    reportAiProvider.calls++;
    await params.emit({ type: "draft_delta", text: "SELECT player" });
    return {
      title: "Recovered draft",
      description: null,
      queryText: "SELECT player FROM competition_rank LIMIT 1",
      explanation: "Recovered from its durable input.",
      warnings: [],
    };
  },
}));
vi.mock("#src/explore/agent.ts", () => ({
  streamExploreAgent: async (params: ExploreAgentParams) => {
    exploreProvider.calls++;
    if (exploreProvider.gate !== null) await exploreProvider.gate;
    await params.emit({ type: "answer_delta", text: "Recovered answer" });
    return {
      answer: {
        answer: "Recovered answer",
        title: null,
        queryText: null,
        includeVisualization: false,
        matchCards: [],
        caveats: [],
        followUps: [],
      },
      preview: null,
      visualization: null,
      matchCards: [],
    };
  },
}));
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  claimScoutEffect,
  completeScoutEffect,
  completeScoutEffectWithResult,
  requireCompletedScoutEffectResult,
} from "#src/temporal/effect-claims.ts";
import {
  durableExploreQuotaRejection,
  reserveDurableExploreRun,
  reserveDurableReportAiRun,
} from "#src/temporal/durable-quota.ts";
import {
  executeRecoveredExplore,
  executeRecoveredReportAi,
  persistScoutInteractiveOutcome,
  runScoutInteractiveActivity,
} from "#src/temporal/interactive-activities.ts";
import { startExploreTurn } from "#src/explore/store.ts";
import {
  ExploreRunManager,
  ExploreRunRateLimitedError,
  ExploreRunUnavailableError,
} from "#src/explore/runs/run-manager.ts";
import { ExploreConversationBusyError } from "#src/explore/rate-limit.ts";
import { setScoutTemporalSupervisor } from "#src/temporal/runtime.ts";

const { prisma } = createTestDatabase("temporal-durability");

beforeEach(async () => {
  setScoutTemporalSupervisor(undefined);
  reportAiProvider.calls = 0;
  exploreProvider.calls = 0;
  exploreProvider.gate = null;
  await prisma.scoutEffectClaim.deleteMany();
  await prisma.scoutInteractiveRun.deleteMany();
  await prisma.exploreMessage.deleteMany();
  await prisma.exploreConversation.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.scoutEffectClaim.deleteMany();
  await prisma.scoutInteractiveRun.deleteMany();
  await prisma.exploreMessage.deleteMany();
  await prisma.exploreConversation.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

describe("durable interactive reservations", () => {
  test("serializes the global Explore cap across concurrent requests", async () => {
    const attempts = await Promise.all(
      Array.from(
        { length: 6 },
        async (_, index) =>
          await reserveDurableExploreRun({
            id: globalThis.crypto.randomUUID(),
            ownerId: DiscordAccountIdSchema.parse(
              (9_000_000_000_000_000_000n + BigInt(index)).toString(),
            ),
            conversationId: globalThis.crypto.randomUUID(),
            payload: "{}",
            now: Date.parse("2026-08-24T12:00:00.000Z"),
            database: prisma,
          }),
      ),
    );

    expect(attempts.filter((result) => result === null)).toHaveLength(5);
    expect(attempts.filter((result) => result !== null)).toHaveLength(1);
    expect(await prisma.scoutInteractiveRun.count()).toBe(5);
  });

  test("allows only one active durable run per Explore conversation", async () => {
    const ownerId = DiscordAccountIdSchema.parse("900000000000000010");
    const conversationId = globalThis.crypto.randomUUID();
    const attempts = await Promise.all(
      [0, 1].map(
        async () =>
          await reserveDurableExploreRun({
            id: globalThis.crypto.randomUUID(),
            ownerId,
            conversationId,
            payload: "{}",
            now: Date.parse("2026-08-24T12:00:00.000Z"),
            database: prisma,
          }),
      ),
    );

    expect(attempts.filter((result) => result === null)).toHaveLength(1);
    expect(attempts.filter((result) => result !== null)).toEqual([
      {
        reason: "This conversation already has an answer running.",
        retryAfterSeconds: 30,
      },
    ]);
    expect(await prisma.scoutInteractiveRun.count()).toBe(1);
  });

  test("allows only one active report edit per user and guild", async () => {
    const identity = {
      userId: DiscordAccountIdSchema.parse("900000000000000101"),
      guildId: DiscordGuildIdSchema.parse("900000000000000102"),
    };
    const attempts = await Promise.all(
      [0, 1].map(
        async () =>
          await reserveDurableReportAiRun({
            id: globalThis.crypto.randomUUID(),
            identity,
            exempt: false,
            payload: "{}",
            now: Date.parse("2026-08-24T12:00:00.000Z"),
            database: prisma,
          }),
      ),
    );

    expect(attempts.filter((result) => result === null)).toHaveLength(1);
    expect(attempts.filter((result) => result !== null)).toHaveLength(1);
  });

  test("releases spend quota when execution fails before the provider claim", async () => {
    const ownerId = DiscordAccountIdSchema.parse("900000000000000111");
    const now = Date.parse("2026-08-24T12:00:00.000Z");
    for (const index of [0, 1, 2, 3, 4]) {
      const id = globalThis.crypto.randomUUID();
      await expect(
        reserveDurableExploreRun({
          id,
          ownerId,
          conversationId: globalThis.crypto.randomUUID(),
          payload: "{}",
          now,
          database: prisma,
        }),
      ).resolves.toBeNull();
      await prisma.scoutInteractiveRun.update({
        where: { id },
        data: { state: "FAILED", completedAt: new Date(now + index) },
      });
    }

    await expect(
      durableExploreQuotaRejection(ownerId, now, prisma),
    ).resolves.toBeNull();
  });

  test("charges spend quota after the provider claim even when execution interrupts", async () => {
    const ownerId = DiscordAccountIdSchema.parse("900000000000000112");
    const now = Date.parse("2026-08-24T12:00:00.000Z");
    for (const index of [0, 1, 2, 3]) {
      await prisma.scoutInteractiveRun.create({
        data: {
          id: globalThis.crypto.randomUUID(),
          kind: "explore",
          ownerId,
          conversationId: globalThis.crypto.randomUUID(),
          payload: "{}",
          state: "INTERRUPTED",
          providerAttemptAt: new Date(now + index),
          completedAt: new Date(now + index),
          createdAt: new Date(now + index),
        },
      });
    }

    await expect(
      durableExploreQuotaRejection(ownerId, now + 4, prisma),
    ).resolves.toMatchObject({ retryAfterSeconds: 60 });
  });
});

describe("durable interactive recovery", () => {
  test("atomically rolls back a turn when Temporal is known unavailable", async () => {
    const ownerId = DiscordAccountIdSchema.parse("900000000000000200");
    await prisma.user.create({
      data: { discordId: ownerId, discordUsername: "unavailable-explorer" },
    });
    const manager = new ExploreRunManager({ client: prisma });

    await expect(
      manager.start(
        { userId: ownerId },
        {
          conversationId: null,
          question: "Can this turn start?",
          attach: { kind: "leaf" },
        },
        [],
      ),
    ).rejects.toBeInstanceOf(ExploreRunUnavailableError);

    await expect(
      prisma.scoutInteractiveRun.findFirstOrThrow({
        where: { kind: "explore", ownerId },
        select: { state: true, outcome: true, lastError: true },
      }),
    ).resolves.toEqual({
      state: "FAILED",
      outcome: "failed",
      lastError: "Temporal is unavailable",
    });
    expect(
      await prisma.exploreConversation.count({ where: { userId: ownerId } }),
    ).toBe(0);
    expect(await prisma.exploreMessage.count()).toBe(0);
  });

  test("interrupts an ambiguous provider attempt without opening a runtime", async () => {
    const runId = globalThis.crypto.randomUUID();
    await prisma.scoutInteractiveRun.create({
      data: {
        id: runId,
        kind: "report-ai",
        ownerId: DiscordAccountIdSchema.parse("900000000000000201"),
        guildId: DiscordGuildIdSchema.parse("900000000000000202"),
        payload: "{}",
        state: "RUNNING",
        providerAttemptAt: new Date(),
        partialOutput: "SELECT player",
      },
    });

    const outcome = await runScoutInteractiveActivity(
      { stage: "dev", kind: "report-ai", databaseRunId: runId },
      prisma,
    );
    expect(outcome).toEqual({
      status: "interrupted",
      partialOutputAvailable: true,
    });
    expect(reportAiProvider.calls).toBe(0);
    await persistScoutInteractiveOutcome(
      { stage: "dev", kind: "report-ai", databaseRunId: runId, outcome },
      prisma,
    );
    expect(
      await prisma.scoutInteractiveRun.findUniqueOrThrow({
        where: { id: runId },
        select: { state: true, providerAttemptAt: true },
      }),
    ).toMatchObject({ state: "INTERRUPTED" });
  });

  test("a settled run keeps no owner-only progress on its row", async () => {
    // `activity` may name the person a turn looked up — that channel is the
    // one place such text is allowed, precisely because it is never stored.
    // These columns exist only so a durable observer can follow a *running*
    // turn, and nothing deletes these rows, so a terminal state has to clear
    // them or "never persisted" quietly becomes "persisted forever".
    const runId = globalThis.crypto.randomUUID();
    await prisma.scoutInteractiveRun.create({
      data: {
        id: runId,
        kind: "explore",
        ownerId: DiscordAccountIdSchema.parse("900000000000000201"),
        payload: "{}",
        state: "RUNNING",
        partialOutput: "Jinx wins.",
        activity: "Finding “Jerred#NA1”",
        preview: JSON.stringify({ rows: [] }),
      },
    });

    await persistScoutInteractiveOutcome(
      {
        stage: "dev",
        kind: "explore",
        databaseRunId: runId,
        outcome: { status: "completed", partialOutputAvailable: true },
      },
      prisma,
    );

    const row = await prisma.scoutInteractiveRun.findUniqueOrThrow({
      where: { id: runId },
      select: { state: true, activity: true, preview: true },
    });
    expect(row).toEqual({
      state: "COMPLETED",
      activity: null,
      preview: null,
    });
  });

  test("rebuilds a pending report-AI execution from its durable payload", async () => {
    const runId = globalThis.crypto.randomUUID();
    const guildId = DiscordGuildIdSchema.parse("900000000000000212");
    await prisma.scoutInteractiveRun.create({
      data: {
        id: runId,
        kind: "report-ai",
        ownerId: DiscordAccountIdSchema.parse("900000000000000211"),
        guildId,
        payload: JSON.stringify({
          edit: {
            guildId,
            instructions: "Make a compact leaderboard",
            currentQueryText: null,
            currentTitle: null,
            currentDescription: null,
            sourceCompetitionId: null,
          },
          exempt: false,
        }),
      },
    });
    const run = await prisma.scoutInteractiveRun.findUniqueOrThrow({
      where: { id: runId },
    });

    await expect(
      executeRecoveredReportAi(run, new AbortController().signal, prisma),
    ).resolves.toEqual({
      status: "completed",
      partialOutputAvailable: true,
    });
    expect(reportAiProvider.calls).toBe(1);
    await expect(
      prisma.scoutInteractiveRun.findUniqueOrThrow({ where: { id: runId } }),
    ).resolves.toMatchObject({
      partialOutput: "SELECT player",
    });
  });
});

test("rebuilds a pending Explore turn from its durable payload", async () => {
  const ownerId = DiscordAccountIdSchema.parse("900000000000000221");
  await prisma.user.create({
    data: { discordId: ownerId, discordUsername: "recovered-explorer" },
  });
  const started = await startExploreTurn(prisma, {
    conversationId: null,
    newId: globalThis.crypto.randomUUID(),
    userId: ownerId,
    question: "Which champion wins the most?",
    attach: { kind: "leaf" },
  });
  const runId = globalThis.crypto.randomUUID();
  const summary = {
    runId,
    conversationId: started.conversationId,
    questionMessageId: started.messageId,
    leafIdAtStart: started.expectedCurrentLeafId,
    versionCountAtStart: 0,
    startedAt: new Date().toISOString(),
  };
  await prisma.scoutInteractiveRun.create({
    data: {
      id: runId,
      kind: "explore",
      ownerId,
      conversationId: started.conversationId,
      payload: JSON.stringify({
        summary,
        started: {
          ...started,
          question: "Which champion wins the most?",
        },
        guildIds: [],
      }),
    },
  });
  const run = await prisma.scoutInteractiveRun.findUniqueOrThrow({
    where: { id: runId },
  });

  const gatewayManager = new ExploreRunManager({ client: prisma });
  await gatewayManager.rehydrateTemporalRun({
    summary,
    identity: { userId: ownerId },
    guildIds: [],
    started: {
      ...started,
      question: "Which champion wins the most?",
    },
    surface: "voice",
    originChannelId: null,
  });
  const applicationManager = new ExploreRunManager({ client: prisma });
  const messagesBeforeRejectedStart = await prisma.exploreMessage.findMany({
    where: { conversationId: started.conversationId },
    select: { id: true, parentId: true, content: true },
    orderBy: { createdAt: "asc" },
  });
  await expect(
    applicationManager.start(
      { userId: ownerId },
      {
        conversationId: started.conversationId,
        question: "Can I ask before the voice activity starts?",
        attach: { kind: "leaf" },
      },
      [],
    ),
  ).rejects.toBeInstanceOf(ExploreRunRateLimitedError);
  await expect(
    prisma.exploreMessage.findMany({
      where: { conversationId: started.conversationId },
      select: { id: true, parentId: true, content: true },
      orderBy: { createdAt: "asc" },
    }),
  ).resolves.toEqual(messagesBeforeRejectedStart);
  const gate = Promise.withResolvers<null>();
  exploreProvider.gate = gate.promise;
  const execution = executeRecoveredExplore(
    run,
    new AbortController().signal,
    prisma,
    applicationManager,
  );
  await vi.waitFor(() => {
    expect(applicationManager.list(ownerId)).toEqual([summary]);
  });
  await expect(
    applicationManager.start(
      { userId: ownerId },
      {
        conversationId: started.conversationId,
        question: "Can I ask from the web too?",
        attach: { kind: "leaf" },
      },
      [],
    ),
  ).rejects.toBeInstanceOf(ExploreConversationBusyError);
  gate.resolve(null);
  await expect(execution).resolves.toBe("succeeded");
  expect(exploreProvider.calls).toBe(1);
  expect(applicationManager.list(ownerId)).toEqual([]);
  expect(gatewayManager.list(ownerId)).toEqual([summary]);
  gatewayManager.settleDurablePlaceholder(runId, "succeeded");
  expect(gatewayManager.list(ownerId)).toEqual([]);
  expect(gatewayManager.outcome(runId, ownerId)).toBe("succeeded");
  await expect(
    prisma.exploreMessage.findFirstOrThrow({
      where: {
        conversationId: started.conversationId,
        role: "assistant",
      },
    }),
  ).resolves.toMatchObject({ content: "Recovered answer" });
});

describe("durable stop handling", () => {
  test("honors a persisted stop before claiming provider spend", async () => {
    const runId = globalThis.crypto.randomUUID();
    await prisma.scoutInteractiveRun.create({
      data: {
        id: runId,
        kind: "report-ai",
        ownerId: DiscordAccountIdSchema.parse("900000000000000301"),
        guildId: DiscordGuildIdSchema.parse("900000000000000302"),
        payload: "{}",
        stopRequestedAt: new Date(),
      },
    });

    await expect(
      runScoutInteractiveActivity(
        { stage: "dev", kind: "report-ai", databaseRunId: runId },
        prisma,
      ),
    ).resolves.toEqual({
      status: "cancelled",
      partialOutputAvailable: false,
    });
    expect(
      await prisma.scoutInteractiveRun.findUniqueOrThrow({
        where: { id: runId },
        select: { providerAttemptAt: true },
      }),
    ).toEqual({ providerAttemptAt: null });
  });
});

test("effect claims survive an ambiguous retry and become terminal", async () => {
  expect(
    await claimScoutEffect(
      { key: "report:42:chunk:0", kind: "report-discord" },
      prisma,
    ),
  ).toBe("execute");
  expect(
    await claimScoutEffect(
      { key: "report:42:chunk:0", kind: "report-discord" },
      prisma,
    ),
  ).toBe("execute");
  await completeScoutEffect("report:42:chunk:0", prisma);
  expect(
    await claimScoutEffect(
      { key: "report:42:chunk:0", kind: "report-discord" },
      prisma,
    ),
  ).toBe("completed");
});

test("effect claims retain a provider result for retry projection", async () => {
  await claimScoutEffect(
    { key: "postmatch:42:channel:7", kind: "discord-channel-message" },
    prisma,
  );
  await completeScoutEffectWithResult(
    "postmatch:42:channel:7",
    "discord-message-99",
    prisma,
  );
  const completed = await requireCompletedScoutEffectResult(
    "postmatch:42:channel:7",
    prisma,
  );
  expect(completed.resultId).toBe("discord-message-99");
  // The claim also brackets the effect it proves, which is what a later pass
  // recovering that effect records instead of its own clock.
  expect(completed.claimedAt.getTime()).toBeLessThanOrEqual(
    completed.completedAt.getTime(),
  );
});
