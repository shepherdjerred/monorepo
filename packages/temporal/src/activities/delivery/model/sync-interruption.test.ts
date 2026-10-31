import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  ActivityCancellationDetails,
  ApplicationFailure,
} from "@temporalio/common";
import { MockActivityEnvironment } from "@temporalio/testing";
import { deliveryOperationId } from "@shepherdjerred/delivery/operation-id";
import { argoApplication } from "#lib/delivery/model/step-testing.ts";
import { forumDetail } from "#lib/delivery/model/forum-testing.ts";
import { withLeaseLoss } from "#lib/delivery/model/effect-signal.ts";
import { DELIVERY_EXECUTOR_REPLACED } from "#shared/delivery-executor.ts";
import type * as ArgoClient from "#lib/delivery/argo-client.ts";
import type * as Argocd from "#activities/delivery/argocd.ts";
import type * as Stages from "./stages.ts";

/**
 * A self-hosted sync whose own worker shuts down mid-operation (D8): the
 * real guarded-command runner, the real Activity cancellation the SDK sends
 * on worker shutdown, and a real child process it kills. Only Argo reads,
 * stage writes and the spawned command line are stand-ins.
 */
const state = vi.hoisted(() => {
  const events: string[] = [];
  const reads: unknown[] = [];
  return { events, reads };
});
vi.mock("#lib/delivery/argo-client.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof ArgoClient>()),
  getArgoApplication: () => {
    state.events.push("read");
    return Promise.resolve(
      state.reads.length > 1 ? state.reads.shift() : state.reads[0],
    );
  },
}));
vi.mock("#activities/delivery/argocd.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof Argocd>()),
  argoRequest: () => Promise.resolve(null),
}));
vi.mock("./stages.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof Stages>()),
  recordStage: (_current: unknown, key: string, status: string) => {
    state.events.push(`${key} ${status}`);
    return Promise.resolve();
  },
  // The successor attempt still owns the deployment under its lease.
  requireOwned: async () => {
    const { forumDetail: detail } =
      await import("#lib/delivery/model/forum-testing.ts");
    return { ...detail().current, selfHosted: true };
  },
}));
vi.mock("./forum-bundle.ts", () => ({
  forumBaselineFence: () => Promise.resolve(),
  forumSyncPrune: () => Promise.resolve(false),
}));

const { sync } = await import("./kubernetes.ts");

const WORKER_SHUTDOWN = new ActivityCancellationDetails({
  workerShutdown: true,
});

function fixture(selfHosted: boolean) {
  const { current, recipe } = forumDetail();
  return { current: { ...current, selfHosted }, recipe };
}

/** The Application with this deployment's request in the given phase. */
function requested(phase: "Running" | "Succeeded" | "Failed") {
  const { current, recipe } = fixture(true);
  const synced = argoApplication(current, recipe, true);
  return {
    ...synced,
    status: {
      ...synced.status,
      ...(phase === "Succeeded"
        ? {}
        : { sync: { status: "OutOfSync" }, health: { status: "Progressing" } }),
      operationState: {
        ...synced.status.operationState,
        phase,
        ...(phase === "Failed"
          ? { message: "one or more objects failed" }
          : {}),
      },
    },
  };
}

/**
 * Stands the guarded Argo CLI in with a real child process: `sleep` runs
 * until something kills it, as a sync-managed wait does; `false` exits 1,
 * as a refused or failed sync does. `started` fires once it runs.
 */
function guardedCommand(program: "sleep" | "false", started?: () => void) {
  const spawn = Bun.spawn;
  vi.spyOn(Bun, "spawn").mockImplementation((command: string[]) => {
    state.events.push(`spawn ${command.slice(2).join(" ")}`);
    const child = spawn(program === "sleep" ? ["sleep", "60"] : ["false"], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    if (started !== undefined) setTimeout(started, 50);
    return child;
  });
}

/** What the attempt failed with; it must fail. */
async function failureOf(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
  } catch (error) {
    return error;
  }
  throw new Error("The sync attempt unexpectedly succeeded");
}

async function replaced(run: Promise<unknown>) {
  const error = await failureOf(run);
  expect(error).toBeInstanceOf(ApplicationFailure);
  if (!(error instanceof ApplicationFailure)) throw error;
  return error;
}

beforeEach(() => {
  state.events = [];
  state.reads = [];
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("A self-hosted sync interrupted by its own executor's replacement (D8)", () => {
  test("the worker shutdown leaves the stage running, and the successor attempt only reads back the recorded request", async () => {
    const { current, recipe } = fixture(true);
    const requestId = deliveryOperationId(current.deployment.id);
    const outgoing = new MockActivityEnvironment();
    state.reads = [argoApplication(current, recipe, false)];
    guardedCommand("sleep", () => {
      outgoing.cancel("WORKER_SHUTDOWN", WORKER_SHUTDOWN);
    });
    const failure = await replaced(
      outgoing.run(sync, current, recipe, "step-sync"),
    );
    expect(failure.type).toBe(DELIVERY_EXECUTOR_REPLACED);
    expect(failure.message).toContain(requestId);
    // The killed CLI's own failure is kept as the cause.
    expect(failure.cause?.message).toBe(
      "Guarded Argo sync-managed failed; inspect the recorded request before retrying",
    );
    expect(state.events).toEqual([
      "read",
      "step-sync running",
      `spawn sync-managed storm-forum --revision 1.0.1 --request-id ${requestId} --timeout 1200`,
    ]);

    // Argo finished the owned operation after the executor was replaced.
    state.events = [];
    state.reads = [requested("Running"), requested("Succeeded")];
    const successor = new MockActivityEnvironment();
    await successor.run(sync, current, recipe, "step-sync");
    expect(state.events).toEqual([
      "read",
      "step-sync running",
      "read",
      "step-sync succeeded",
    ]);
  });

  test("a genuinely Failed owned operation still fails the resumed step", async () => {
    const { current, recipe } = fixture(true);
    state.reads = [requested("Failed")];
    const successor = new MockActivityEnvironment();
    await expect(
      successor.run(sync, current, recipe, "step-sync"),
    ).rejects.toThrow("Owned sync of storm-forum ended Failed");
    expect(state.events).toEqual(["read"]);
  });

  test("a guarded command that fails on its own is never a replacement", async () => {
    const { current, recipe } = fixture(true);
    state.reads = [argoApplication(current, recipe, false)];
    guardedCommand("false");
    const error = await failureOf(
      new MockActivityEnvironment().run(sync, current, recipe, "step-sync"),
    );
    expect(error).not.toBeInstanceOf(ApplicationFailure);
    expect(error).toBeInstanceOf(Error);
    expect(state.events).not.toContain("step-sync succeeded");
  });

  test.each([
    ["an ordinary deployment's worker shutdown", false, "WORKER_SHUTDOWN"],
    ["a requested cancellation", true, "CANCELLED"],
  ] as const)(
    "%s fails as before, for inspection",
    async (_name, selfHosted, reason) => {
      const { current, recipe } = fixture(selfHosted);
      state.reads = [argoApplication(current, recipe, false)];
      const environment = new MockActivityEnvironment();
      guardedCommand("sleep", () => {
        environment.cancel(reason);
      });
      const error = await failureOf(
        environment.run(sync, current, recipe, "step-sync"),
      );
      expect(error).not.toBeInstanceOf(ApplicationFailure);
      expect(error).toBeInstanceOf(Error);
    },
  );

  test("a lost lease is never a replacement, even when the worker then shuts down (D7)", async () => {
    const { current, recipe } = fixture(true);
    state.reads = [argoApplication(current, recipe, false)];
    const lost = new AbortController();
    const environment = new MockActivityEnvironment();
    guardedCommand("sleep", () => {
      lost.abort(new Error("The deployment's lease expired (D7)"));
      environment.cancel("WORKER_SHUTDOWN", WORKER_SHUTDOWN);
    });
    const error = await failureOf(
      environment.run(
        async () =>
          await withLeaseLoss(
            lost.signal,
            async () => await sync(current, recipe, "step-sync"),
          ),
      ),
    );
    expect(error).not.toBeInstanceOf(ApplicationFailure);
    expect(error).toBeInstanceOf(Error);
  });
});
