import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import {
  DiscordAccountIdSchema,
  type ExploreActiveRun,
  type ExploreStreamEvent,
} from "@scout-for-lol/data";
import { createOfflineTrpcHarness } from "#src/testing/test-trpc-caller.ts";
import {
  ExploreConversationBusyError,
  ExploreRunManager,
  type ExploreAgentRunner,
} from "#src/explore/run-manager.ts";
import {
  resetExploreRateLimitStateForTests,
  getExploreQuotaStatus,
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
  });

  test("one user can run distinct conversations but not two turns in one conversation", async () => {
    const agent = controlledAgent();
    const manager = createManager(agent);
    const first = await startNew(manager, "Question A");
    const second = await startNew(manager, "Question B");

    expect(manager.list(owner)).toHaveLength(2);
    expect(
      manager.start(
        { userId: owner },
        {
          conversationId: first.conversationId,
          question: "Another turn",
          attach: { kind: "leaf" },
        },
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
    expect(manager.stop(summary.runId, stranger)).toBe(false);
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

    expect(manager.stop(first.runId, owner)).toBe(true);
    expect(await firstFinished).toBe("stopped");
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

    await manager.stopConversationAndWait(first.conversationId, owner);
    expect(await firstFinished).toBe("stopped");
    expect(manager.list(owner).map((run) => run.runId)).toEqual([second.runId]);

    requiredRun(agent, 1).resolve(successfulResult("Answer B"));
    expect(await secondFinished).toBe("succeeded");
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
});
