import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import {
  DiscordAccountIdSchema,
  EXPLORE_ANSWER_MAX_LENGTH,
  type ExploreActiveRun,
  type ExploreStreamEvent,
} from "@scout-for-lol/data";
import { createOfflineTrpcHarness } from "#src/testing/test-trpc-caller.ts";
import {
  ExploreRunManager,
  ExploreRunUnavailableError,
} from "#src/explore/run-manager.ts";
import type { ExploreAgentRunner } from "#src/explore/run-manager-types.ts";
import {
  ExploreConversationBusyError,
  resetExploreRateLimitStateForTests,
  getExploreQuotaStatus,
  tryStartExploreTurn,
} from "#src/explore/rate-limit.ts";
import type {
  ExploreAgentParams,
  ExploreAgentResult,
} from "#src/explore/agent.ts";

const trpc = await createOfflineTrpcHarness("explore-run-manager");
const owner = DiscordAccountIdSchema.parse("900000000000009501");
const stranger = DiscordAccountIdSchema.parse("900000000000009502");
const managers: ExploreRunManager[] = [];

type ControlledRun = {
  params: ExploreAgentParams;
  resolve: (result: ExploreAgentResult) => void;
  reject: (error: Error) => void;
};

function controlledAgent(): {
  runAgent: ExploreAgentRunner;
  runs: ControlledRun[];
} {
  const runs: ControlledRun[] = [];
  const runAgent: ExploreAgentRunner = async (params) => {
    let control: ControlledRun | null = null;
    const result = new Promise<ExploreAgentResult>((resolve, reject) => {
      control = { params, resolve, reject };
    });
    if (control === null) {
      throw new Error("Explore test run was not initialized.");
    }
    runs.push(control);
    const onAbort = (): void => {
      control?.reject(new Error("Explore test run aborted."));
    };
    params.abortSignal.addEventListener("abort", onAbort, { once: true });
    try {
      return await result;
    } finally {
      params.abortSignal.removeEventListener("abort", onAbort);
    }
  };
  return { runAgent, runs };
}

function createManager(
  agent: ReturnType<typeof controlledAgent>,
  timeoutMs = 10_000,
): ExploreRunManager {
  const manager = new ExploreRunManager({
    client: trpc.prisma,
    runAgent: agent.runAgent,
    timeoutMs,
  });
  managers.push(manager);
  return manager;
}

function successfulResult(answer: string): ExploreAgentResult {
  return {
    answer: {
      answer,
      title: null,
      queryText: null,
      caveats: [],
      followUps: [],
    },
    preview: null,
    visualization: null,
  };
}

const resolveAfterAbortAgent: ExploreAgentRunner = async (params) => {
  return await new Promise((resolve) => {
    params.abortSignal.addEventListener(
      "abort",
      () => resolve(successfulResult("Late successful answer")),
      { once: true },
    );
  });
};

function requiredRun(
  agent: ReturnType<typeof controlledAgent>,
  index: number,
): ControlledRun {
  const run = agent.runs[index];
  if (run === undefined) {
    throw new Error(`Expected controlled Explore run ${index.toString()}.`);
  }
  return run;
}

function observeUntilDone(
  manager: ExploreRunManager,
  summary: ExploreActiveRun,
  events: ExploreStreamEvent[] = [],
): Promise<Extract<ExploreStreamEvent, { type: "done" }>["outcome"]> {
  return new Promise((resolve, reject) => {
    const unsubscribe = manager.subscribe(summary.runId, owner, (event) => {
      events.push(event);
      if (event.type === "done") {
        resolve(event.outcome);
      }
    });
    if (unsubscribe === null) {
      reject(new Error("Expected to observe an active Explore run."));
    }
  });
}

async function startNew(manager: ExploreRunManager, question: string) {
  return await manager.start(
    { userId: owner },
    { conversationId: null, question, attach: { kind: "leaf" } },
    [],
  );
}

beforeEach(async () => {
  resetExploreRateLimitStateForTests();
  await trpc.prisma.exploreMessage.deleteMany();
  await trpc.prisma.exploreConversation.deleteMany();
  await trpc.prisma.user.upsert({
    where: { discordId: owner },
    create: { discordId: owner, discordUsername: "owner" },
    update: {},
  });
});

afterEach(async () => {
  await Promise.all(
    managers.splice(0).map(async (manager) => manager.shutdown()),
  );
  resetExploreRateLimitStateForTests();
});

afterAll(async () => {
  await trpc.prisma.$disconnect();
});

describe("ExploreRunManager", () => {
  test("disconnecting an observer leaves the run alive and reconnect snapshots exactly", async () => {
    const agent = controlledAgent();
    const manager = createManager(agent);
    const summary = await startNew(manager, "Who wins most?");
    const firstEvents: ExploreStreamEvent[] = [];
    const unsubscribe = manager.subscribe(summary.runId, owner, (event) => {
      firstEvents.push(event);
    });
    if (unsubscribe === null) throw new Error("Expected an observer.");

    await requiredRun(agent, 0).params.emit({
      type: "answer_delta",
      text: "Jinx ",
    });
    unsubscribe();
    await requiredRun(agent, 0).params.emit({
      type: "answer_delta",
      text: "wins.",
    });

    const reconnected: ExploreStreamEvent[] = [];
    const finished = observeUntilDone(manager, summary, reconnected);
    expect(reconnected[0]).toMatchObject({
      type: "snapshot",
      answer: "Jinx wins.",
      activity: "Thinking…",
      trace: [],
    });
    expect(manager.list(owner)).toHaveLength(1);

    requiredRun(agent, 0).resolve(successfulResult("Jinx wins."));
    expect(await finished).toBe("succeeded");
    expect(firstEvents.some((event) => event.type === "done")).toBe(false);
    expect(manager.list(owner)).toEqual([]);
    expect(manager.outcome(summary.runId, owner)).toBe("succeeded");
    expect(manager.outcome(summary.runId, stranger)).toBeNull();
  });

  test("reconnect snapshots remain valid after overlong partial output", async () => {
    const agent = controlledAgent();
    const manager = createManager(agent);
    const summary = await startNew(manager, "Who wins most?");
    const answer = "x".repeat(EXPLORE_ANSWER_MAX_LENGTH);

    await requiredRun(agent, 0).params.emit({
      type: "answer_delta",
      text: answer,
    });
    await requiredRun(agent, 0).params.emit({
      type: "answer_delta",
      text: "overflow",
    });

    const reconnected: ExploreStreamEvent[] = [];
    const finished = observeUntilDone(manager, summary, reconnected);
    expect(reconnected[0]).toMatchObject({
      type: "snapshot",
      answer,
    });

    requiredRun(agent, 0).resolve(successfulResult(answer));
    expect(await finished).toBe("succeeded");
  });

  test("one user can run distinct conversations but not two turns in one conversation", async () => {
    const agent = controlledAgent();
    const manager = createManager(agent);
    const first = await startNew(manager, "Question A");
    const second = await startNew(manager, "Question B");

    expect(manager.list(owner)).toHaveLength(2);
    await expect(
      manager.start(
        { userId: owner },
        {
          conversationId: first.conversationId,
          question: "Another turn",
          attach: { kind: "leaf" },
        },
        [],
      ),
    ).rejects.toBeInstanceOf(ExploreConversationBusyError);

    const firstFinished = observeUntilDone(manager, first);
    const secondFinished = observeUntilDone(manager, second);
    requiredRun(agent, 0).resolve(successfulResult("Answer A"));
    requiredRun(agent, 1).resolve(successfulResult("Answer B"));
    expect(await Promise.all([firstFinished, secondFinished])).toEqual([
      "succeeded",
      "succeeded",
    ]);
    const minute = getExploreQuotaStatus({ userId: owner }).quota.find(
      (quota) => quota.scope === "user" && quota.window === "minute",
    );
    expect(minute?.used).toBe(2);
  });

  test("a Discord-owned conversation blocks a web follow-up", async () => {
    const agent = controlledAgent();
    const manager = createManager(agent);
    const conversation = await trpc.prisma.exploreConversation.create({
      data: {
        userId: owner,
        title: "Discord question",
        messages: { create: { role: "user", content: "Who wins?" } },
      },
    });
    const discordTicket = tryStartExploreTurn({ userId: owner });
    if (!discordTicket.allowed) {
      throw new Error("Expected a Discord turn ticket.");
    }
    expect(discordTicket.claimConversation(conversation.id)).toBe(true);

    await expect(
      manager.start(
        { userId: owner },
        {
          conversationId: conversation.id,
          question: "What about this patch?",
          attach: { kind: "leaf" },
        },
        [],
      ),
    ).rejects.toBeInstanceOf(ExploreConversationBusyError);
    expect(
      await trpc.prisma.exploreMessage.count({
        where: { conversationId: conversation.id },
      }),
    ).toBe(1);
    discordTicket.finish();
  });

  test("regeneration records every answer version that predates the run", async () => {
    const agent = controlledAgent();
    const manager = createManager(agent);
    const conversation = await trpc.prisma.exploreConversation.create({
      data: {
        userId: owner,
        title: "Regeneration",
        messages: { create: { role: "user", content: "Who wins?" } },
      },
      include: { messages: true },
    });
    const question = conversation.messages[0];
    if (question === undefined) throw new Error("Expected a question.");
    await trpc.prisma.exploreMessage.createMany({
      data: [
        {
          conversationId: conversation.id,
          parentId: question.id,
          role: "assistant",
          content: "First answer",
        },
        {
          conversationId: conversation.id,
          parentId: question.id,
          role: "assistant",
          content: "Second answer",
        },
      ],
    });

    const summary = await manager.start(
      { userId: owner },
      {
        conversationId: conversation.id,
        question: null,
        attach: { kind: "message", messageId: question.id },
      },
      [],
    );
    expect(summary.versionCountAtStart).toBe(2);

    const finished = observeUntilDone(manager, summary);
    requiredRun(agent, 0).resolve(successfulResult("Third answer"));
    expect(await finished).toBe("succeeded");
  });
});

describe("ExploreRunManager lifecycle", () => {
  test("owner checks hide listing, observation, and stopping", async () => {
    const agent = controlledAgent();
    const manager = createManager(agent);
    const summary = await startNew(manager, "Private question");

    expect(manager.list(stranger)).toEqual([]);
    expect(
      manager.subscribe(summary.runId, stranger, () => {
        // An unauthorized observer must never receive an event.
      }),
    ).toBeNull();
    expect(await manager.stop(summary.runId, stranger)).toBe(false);
    expect(manager.list(owner)).toHaveLength(1);

    const finished = observeUntilDone(manager, summary);
    requiredRun(agent, 0).resolve(successfulResult("Private answer"));
    expect(await finished).toBe("succeeded");
  });

  test("stopping one run does not affect another", async () => {
    const agent = controlledAgent();
    const manager = createManager(agent);
    const first = await startNew(manager, "Question A");
    const second = await startNew(manager, "Question B");
    const firstFinished = observeUntilDone(manager, first);
    const secondFinished = observeUntilDone(manager, second);

    expect(await manager.stop(first.runId, owner)).toBe(true);
    expect(await firstFinished).toBe("stopped");
    expect(manager.outcome(first.runId, owner)).toBe("stopped");
    expect(manager.list(owner).map((run) => run.runId)).toEqual([second.runId]);

    requiredRun(agent, 1).resolve(successfulResult("Answer B"));
    expect(await secondFinished).toBe("succeeded");
  });

  test("deleting one conversation waits for only its run", async () => {
    const agent = controlledAgent();
    const manager = createManager(agent);
    const first = await startNew(manager, "Question A");
    const second = await startNew(manager, "Question B");
    const firstFinished = observeUntilDone(manager, first);
    const secondFinished = observeUntilDone(manager, second);

    expect(
      await manager.deleteConversationAndWait(first.conversationId, owner),
    ).toBe(true);
    expect(await firstFinished).toBe("stopped");
    expect(manager.list(owner).map((run) => run.runId)).toEqual([second.runId]);
    expect(
      await trpc.prisma.exploreConversation.findUnique({
        where: { id: first.conversationId },
      }),
    ).toBeNull();

    requiredRun(agent, 1).resolve(successfulResult("Answer B"));
    expect(await secondFinished).toBe("succeeded");
  });

  test("a non-owner deletion cannot block the owner's next turn", async () => {
    const agent = controlledAgent();
    const manager = createManager(agent);
    const conversation = await trpc.prisma.exploreConversation.create({
      data: {
        userId: owner,
        title: "Private conversation",
        messages: { create: { role: "user", content: "First question" } },
      },
    });

    const unauthorizedDeletion = manager.deleteConversationAndWait(
      conversation.id,
      stranger,
    );
    const started = await manager.start(
      { userId: owner },
      {
        conversationId: conversation.id,
        question: "Owner's next question",
        attach: { kind: "leaf" },
      },
      [],
    );

    expect(await unauthorizedDeletion).toBe(false);
    const finished = observeUntilDone(manager, started);
    requiredRun(agent, 0).resolve(successfulResult("Owner's next answer"));
    expect(await finished).toBe("succeeded");
  });

  test("deletion waits for a turn still in its reservation phase", async () => {
    const agent = controlledAgent();
    const manager = createManager(agent);
    const conversation = await trpc.prisma.exploreConversation.create({
      data: {
        userId: owner,
        title: "Delete race",
        messages: { create: { role: "user", content: "First question" } },
      },
    });

    const started = manager.start(
      { userId: owner },
      {
        conversationId: conversation.id,
        question: "Question racing deletion",
        attach: { kind: "leaf" },
      },
      [],
    );
    const deleted = manager.deleteConversationAndWait(conversation.id, owner);

    await started;
    expect(await deleted).toBe(true);
    expect(manager.list(owner)).toEqual([]);
    expect(
      await trpc.prisma.exploreConversation.findUnique({
        where: { id: conversation.id },
      }),
    ).toBeNull();
  });

  test("provider failure persists interruption semantics and releases capacity", async () => {
    const agent = controlledAgent();
    const manager = createManager(agent);
    const summary = await startNew(manager, "Broken question");
    const events: ExploreStreamEvent[] = [];
    const finished = observeUntilDone(manager, summary, events);

    requiredRun(agent, 0).reject(new Error("Provider failed."));
    expect(await finished).toBe("failed");
    expect(events).toContainEqual({
      type: "error",
      message: "This answer could not be completed.",
      retryAfterSeconds: null,
      quota: expect.any(Array),
    });
    expect(getExploreQuotaStatus({ userId: owner }).activeRun).toBe(false);
  });

  test("a timeout interrupts its run and releases capacity", async () => {
    const agent = controlledAgent();
    const manager = createManager(agent, 5);
    const summary = await startNew(manager, "Slow question");
    const finished = observeUntilDone(manager, summary);

    expect(await finished).toBe("interrupted");
    expect(manager.list(owner)).toEqual([]);
    expect(getExploreQuotaStatus({ userId: owner }).activeRun).toBe(false);
  });

  test("a provider resolving after abort cannot turn a stop into success", async () => {
    const manager = new ExploreRunManager({
      client: trpc.prisma,
      runAgent: resolveAfterAbortAgent,
      timeoutMs: 10_000,
    });
    managers.push(manager);
    const summary = await startNew(manager, "Stop this question");
    const events: ExploreStreamEvent[] = [];
    const finished = observeUntilDone(manager, summary, events);

    expect(await manager.stop(summary.runId, owner)).toBe(true);
    expect(await finished).toBe("stopped");
    expect(
      events.some(
        (event) =>
          event.type === "final" &&
          event.message.content === "Late successful answer",
      ),
    ).toBe(false);
    expect(events.some((event) => event.type === "final")).toBe(false);
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(
      await trpc.prisma.exploreMessage.count({
        where: {
          conversationId: summary.conversationId,
          role: "assistant",
        },
      }),
    ).toBe(0);
  });

  test("graceful shutdown interrupts every active run", async () => {
    const agent = controlledAgent();
    const manager = createManager(agent);
    const first = await startNew(manager, "Question A");
    const second = await startNew(manager, "Question B");
    const firstFinished = observeUntilDone(manager, first);
    const secondFinished = observeUntilDone(manager, second);

    await manager.shutdown();
    expect(await Promise.all([firstFinished, secondFinished])).toEqual([
      "interrupted",
      "interrupted",
    ]);
    expect(manager.list(owner)).toEqual([]);
    expect(getExploreQuotaStatus({ userId: owner }).activeRun).toBe(false);
  });

  test("graceful shutdown closes admission before draining", async () => {
    const agent = controlledAgent();
    const manager = createManager(agent);

    await manager.shutdown();

    await expect(startNew(manager, "Too late")).rejects.toBeInstanceOf(
      ExploreRunUnavailableError,
    );
    expect(manager.list(owner)).toEqual([]);
  });
});
