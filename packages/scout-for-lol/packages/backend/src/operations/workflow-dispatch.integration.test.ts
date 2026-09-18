import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { DiscordAccountIdSchema } from "@scout-for-lol/domain/identity/discord.ts";
import {
  scoutLakeProjectionV2WorkflowId,
  scoutPipelineReconciliationV2WorkflowId,
} from "@scout-for-lol/temporal";
import * as databaseModule from "#src/database/index.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  fakeV2Temporal,
  type FakeV2Temporal,
} from "#src/testing/fake-v2-temporal.ts";
import {
  IsoInstantSchema,
  WorkflowRunIdSchema,
  type WorkflowStartRequestId,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  recordWorkflowStartAccepted,
  requestWorkflowStart,
} from "#src/database/durable/workflow-start-repository.ts";
import { startScoutPipelineReconciliationV2 } from "#src/temporal/starts-v2.ts";

/**
 * The operator dispatch against a real durable table and a modelled Temporal.
 *
 * The properties under test are the ones SJ-205 changed: the same Workflow id
 * can be requested again and again, each request has its own key, and the
 * answer says what THIS request found — a run it reached, a run it provably
 * did not begin, a refusal, or a wait for Temporal — never what an earlier
 * request did, and never an authorship claim the client cannot support.
 *
 * Module mocks must be installed before the dispatcher is imported, so it is
 * imported dynamically below them.
 */

const { prisma: base } = createTestDatabase("operations-workflow-dispatch");
/**
 * Steps a test can run around the dispatcher's durable INSERT of its request,
 * to place a concurrent confirmation exactly inside the race window. Consumed
 * on first use so the winner's own writes are not intercepted.
 */
let aroundInsert: {
  before?: () => Promise<void>;
  after?: () => Promise<void>;
} | null = null;
/**
 * The same seam around the dispatcher's durable acceptance UPDATE, so a test
 * can place the other driver of an adopted request between this call's start
 * and the moment it writes what Temporal answered. Also consumed on first use.
 */
let beforeAccept: (() => Promise<void>) | null = null;
const prisma = base.$extends({
  query: {
    scoutWorkflowStart: {
      async createMany({ args, query }) {
        const hooks = aroundInsert;
        aroundInsert = null;
        await hooks?.before?.();
        const result = await query(args);
        await hooks?.after?.();
        return result;
      },
      async updateMany({ args, query }) {
        const hook = beforeAccept;
        beforeAccept = null;
        await hook?.();
        return await query(args);
      },
    },
  },
});
vi.doMock("#src/database/index.ts", () => ({ ...databaseModule, prisma }));

let temporal: FakeV2Temporal = fakeV2Temporal();
let available = true;
/**
 * And around the dispatcher's START call, so a test can run the other driver
 * to completion — start, acceptance, and the run closing — before this call's
 * start reaches Temporal. Steps run against `temporal.client` directly, so
 * they are not themselves intercepted.
 */
let beforeStart: (() => Promise<void>) | null = null;
/** How many times the DISPATCHER asked Temporal, as against the other driver. */
let dispatcherStarts = 0;
const hookedClient = {
  workflow: {
    start: async (
      ...args: Parameters<FakeV2Temporal["client"]["workflow"]["start"]>
    ) => {
      dispatcherStarts += 1;
      const hook = beforeStart;
      beforeStart = null;
      await hook?.();
      return await temporal.client.workflow.start(...args);
    },
  },
};
vi.doMock("#src/temporal/runtime.ts", () => ({
  currentScoutTemporalSupervisor: () =>
    available ? { client: () => hookedClient } : undefined,
  setScoutTemporalSupervisor: vi.fn(),
}));
vi.doMock("#src/temporal/availability.ts", () => ({
  scoutTemporalStartsAvailable: () => available,
}));

const { dispatchOperationsWorkflowStart } =
  await import("#src/operations/workflow-dispatch.ts");

const STAGE = "beta";
const OPERATOR = DiscordAccountIdSchema.parse("200000000000000001");
const MATCH_ID = RiotMatchIdSchema.parse("NA1_5312279829");
const RECONCILE_ID = scoutPipelineReconciliationV2WorkflowId(STAGE, "operator");
const PROJECTION_ID = scoutLakeProjectionV2WorkflowId(STAGE, MATCH_ID);

async function reconcile() {
  return await dispatchOperationsWorkflowStart(
    STAGE,
    { kind: "reconcile-pipeline" },
    OPERATOR,
  );
}

async function repair() {
  return await dispatchOperationsWorkflowStart(
    STAGE,
    { kind: "repair-projection", riotMatchId: MATCH_ID },
    OPERATOR,
  );
}

function now() {
  return IsoInstantSchema.parse(new Date().toISOString());
}

const RECONCILE_INPUT = { stage: STAGE, trigger: "operator" } as const;
/**
 * The instant the OTHER driver of a shared request heard back. A fixed one,
 * unequal to the dispatcher's own `new Date()`, so the tests below exercise
 * two observers of one answer stamping different clocks every run rather than
 * only when the two happen to straddle a millisecond — which is what made the
 * CI failure look like flake.
 */
const OBSERVED = IsoInstantSchema.parse("2026-09-16T10:00:00.000Z");

/** The other driver records its request for RECONCILE_ID, and wins. */
async function otherDriverRequests(): Promise<WorkflowStartRequestId> {
  const other = await requestWorkflowStart(base, {
    requestedWorkflowId: RECONCILE_ID,
    workflowType: "scoutPipelineReconciliationV2Workflow",
    requestedBy: OPERATOR,
    requestSource: "operations:reconcile-pipeline",
    inputPayload: {
      kind: "scoutPipelineReconciliationV2Workflow",
      version: 1,
      data: RECONCILE_INPUT,
    },
    requestedAt: now(),
  });
  if (other.outcome !== "applied") {
    throw new Error(
      `the other driver did not record its request: ${other.outcome}`,
    );
  }
  return other.record.requestId;
}

/**
 * Puts the other driver inside the dispatcher's insert window, so its request
 * is the one in flight when the dispatcher's own insert is refused. Returns
 * the id it recorded, readable once the window has passed.
 */
function armOtherDriver(
  afterInsert?: (requestId: WorkflowStartRequestId) => Promise<void>,
): () => WorkflowStartRequestId {
  let recorded: WorkflowStartRequestId | undefined;
  const read = () => {
    if (recorded === undefined) {
      throw new Error("the other driver never recorded its request");
    }
    return recorded;
  };
  aroundInsert = {
    before: async () => {
      recorded = await otherDriverRequests();
    },
    after: async () => {
      await afterInsert?.(read());
    },
  };
  return read;
}

/** The other driver asks Temporal and records what it was told. */
async function otherDriverAccepts(
  requestId: WorkflowStartRequestId,
  acceptedAt: ReturnType<typeof now>,
): Promise<string> {
  const started = await startScoutPipelineReconciliationV2(
    temporal.client,
    RECONCILE_INPUT,
  );
  const accepted = await recordWorkflowStartAccepted(base, {
    requestId,
    acceptedAt,
    runId: WorkflowRunIdSchema.parse(started.firstExecutionRunId),
  });
  if (accepted.outcome !== "applied") {
    throw new Error(
      `the other driver did not record its acceptance: ${accepted.outcome}`,
    );
  }
  return started.firstExecutionRunId;
}

/**
 * The answer and the record when one execution served both drivers of a
 * shared request: the run named, recorded once, on the other driver's
 * request. The outcome differs between those tests and is passed in, because
 * only one of them can PROVE this call began nothing.
 */
async function expectTheOneRun(
  result: Awaited<ReturnType<typeof reconcile>>,
  requestId: WorkflowStartRequestId,
  outcome: "joined-running" | "reached-running",
) {
  expect(result).toEqual({
    outcome,
    requestId,
    requestedWorkflowId: RECONCILE_ID,
    runId: "run-1",
  });
  expect(temporal.starts).toHaveLength(1);
  const rows = await rowsFor(RECONCILE_ID);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ requestId, runId: "run-1" });
  expect(rows[0]?.acceptedAt?.toISOString()).toBe(OBSERVED);
}

async function rowsFor(requestedWorkflowId: string) {
  return await prisma.scoutWorkflowStart.findMany({
    where: { requestedWorkflowId },
    orderBy: { createdAt: "asc" },
  });
}

beforeEach(async () => {
  await prisma.scoutWorkflowStart.deleteMany();
  temporal = fakeV2Temporal();
  available = true;
  aroundInsert = null;
  beforeAccept = null;
  beforeStart = null;
  dispatcherStarts = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("one request, one run", () => {
  test("records the request, reaches the run, and records the acceptance on that request", async () => {
    const result = await reconcile();
    // `reached-running` rather than `started` even here, with nothing else in
    // the picture: this call really did begin run-1, and the client has no way
    // to establish that. The console gets the run and no claim of authorship.
    expect(result).toEqual({
      outcome: "reached-running",
      requestId: result.requestId,
      requestedWorkflowId: RECONCILE_ID,
      runId: "run-1",
    });
    const rows = await rowsFor(RECONCILE_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      requestId: result.requestId,
      requestedBy: OPERATOR,
      requestSource: "operations:reconcile-pipeline",
      runId: "run-1",
    });
    expect(rows[0]?.acceptedAt).not.toBeNull();
    expect(temporal.starts).toHaveLength(1);
  });
});

describe("repeat requests for one Workflow id", () => {
  test("while the run is open, a second request joins it and says so", async () => {
    const first = await reconcile();
    const second = await reconcile();

    expect(second.outcome).toBe("joined-running");
    if (second.outcome !== "joined-running") {
      throw new Error("unreachable");
    }
    // A run this request did not begin is reported as joined, not started.
    expect(second.runId).toBe("run-1");
    expect(second.requestId).not.toBe(first.requestId);
    expect(temporal.starts).toHaveLength(1);

    // Both requests are recorded and both were satisfied by the one run.
    const rows = await rowsFor(RECONCILE_ID);
    expect(rows.map((row) => row.runId)).toEqual(["run-1", "run-1"]);
    expect(rows.every((row) => row.acceptedAt !== null)).toBe(true);
  });

  test("after the run closed, a second request reaches a new run", async () => {
    // The repeat operator reconcile from the beta acceptance checklist: one
    // sweep per stage forever was the SJ-205 defect. The new run is reported
    // as reached rather than started — it is not the recorded run, which is
    // all the client can tell.
    const first = await reconcile();
    temporal.close(RECONCILE_ID, "completed");

    const second = await reconcile();

    expect(second).toEqual({
      outcome: "reached-running",
      requestId: second.requestId,
      requestedWorkflowId: RECONCILE_ID,
      runId: "run-2",
    });
    expect(second.requestId).not.toBe(first.requestId);
    expect(temporal.starts).toHaveLength(2);
    const rows = await rowsFor(RECONCILE_ID);
    expect(rows.map((row) => row.runId)).toEqual(["run-1", "run-2"]);
  });

  test("a repair after a SUCCESSFUL projection is refused by policy, and the refused request is adopted next time", async () => {
    await repair();
    temporal.close(PROJECTION_ID, "completed");

    const refused = await repair();
    expect(refused).toEqual({
      outcome: "already-run",
      requestId: refused.requestId,
      requestedWorkflowId: PROJECTION_ID,
    });
    // The refused request stays, unaccepted, for the sweep to fold.
    const rows = await rowsFor(PROJECTION_ID);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      requestId: refused.requestId,
      acceptedAt: null,
    });

    // Asking again adopts that in-flight request rather than adding a third.
    const again = await repair();
    expect(again).toEqual({ ...refused });
    expect(await rowsFor(PROJECTION_ID)).toHaveLength(2);
    expect(temporal.starts).toHaveLength(1);
  });

  test("a repair after a FAILED projection re-runs it", async () => {
    await repair();
    temporal.close(PROJECTION_ID, "failed");

    const second = await repair();
    expect(second.outcome).toBe("reached-running");
    expect(temporal.starts).toHaveLength(2);
  });
});

describe("Temporal unavailable", () => {
  test("the request is recorded unaccepted; asking again once reachable adopts it and reaches the run", async () => {
    available = false;
    const waiting = await reconcile();
    expect(waiting).toEqual({
      outcome: "unavailable",
      requestId: waiting.requestId,
      requestedWorkflowId: RECONCILE_ID,
    });
    expect(await rowsFor(RECONCILE_ID)).toHaveLength(1);
    expect(temporal.starts).toHaveLength(0);

    available = true;
    const started = await reconcile();
    expect(started).toEqual({
      outcome: "reached-running",
      requestId: waiting.requestId,
      requestedWorkflowId: RECONCILE_ID,
      runId: "run-1",
    });
    expect(await rowsFor(RECONCILE_ID)).toHaveLength(1);
  });
});

describe("simultaneous requests", () => {
  test("a confirmation that loses the durable race to an already-accepted twin joins its run without a throw", async () => {
    // The narrow window Codex named: the winner records its request while
    // this call is between its read and its insert (so the insert is refused)
    // and then starts and ACCEPTS before this call reads again. There is no
    // in-flight row to adopt any more; the accepted one is this call's own
    // start, and the answer is that run — not a second run, not a failure.
    const otherDriver = armOtherDriver(async (requestId) => {
      expect(await otherDriverAccepts(requestId, OBSERVED)).toBe("run-1");
    });

    const result = await reconcile();

    // Proven, and the only case that is: this call asked Temporal nothing at
    // all, so it cannot have begun the run it is reporting.
    await expectTheOneRun(result, otherDriver(), "joined-running");
    expect(dispatcherStarts).toBe(0);
  });

  test("a driver that adopted an in-flight request reports the one run without claiming it", async () => {
    // The interleaving that turned main red, injected rather than raced for.
    // This call adopts a request another driver still has in flight, so BOTH
    // ask Temporal and the conflict policy gives both the same run. The other
    // driver records the acceptance first, stamped with the instant IT heard
    // back. No throw over two observers of one answer disagreeing about the
    // clock — and no authorship claim either way, because losing the
    // acceptance write says who wrote the evidence, not who began the run.
    // Here this call is in fact the one that created run-1 and the other
    // driver joined it, which is exactly why `joined-running` would be false.
    const otherDriver = armOtherDriver();
    beforeAccept = async () => {
      expect(await otherDriverAccepts(otherDriver(), OBSERVED)).toBe("run-1");
    };

    const result = await reconcile();

    // One row, accepted once, holding the acceptance that landed first — at
    // the other driver's instant, not this call's.
    await expectTheOneRun(result, otherDriver(), "reached-running");
    expect(dispatcherStarts).toBe(1);
  });

  test("a driver whose adopted request was answered by a closed run reports the run it reached", async () => {
    // Same adoption, but the recorded run CLOSES before this call's start
    // lands, so reconciliation's ALLOW_DUPLICATE reuse policy admits another
    // execution. Two runs are real. The row keeps the answer to the handoff it
    // names, and this answer keeps the run this call reached — without
    // claiming to have begun it, because a sweep child start could have begun
    // run-2 a moment earlier and this start joined it.
    const otherDriver = armOtherDriver();
    beforeStart = async () => {
      expect(await otherDriverAccepts(otherDriver(), OBSERVED)).toBe("run-1");
      temporal.close(RECONCILE_ID, "completed");
    };

    const result = await reconcile();

    expect(result).toEqual({
      outcome: "reached-running",
      requestId: otherDriver(),
      requestedWorkflowId: RECONCILE_ID,
      runId: "run-2",
    });
    expect(temporal.starts).toHaveLength(2);
    // The row still holds the answer to the handoff it names, exactly as the
    // other driver wrote it. Evidence is never overwritten.
    const rows = await rowsFor(RECONCILE_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      requestId: otherDriver(),
      runId: "run-1",
    });
    expect(rows[0]?.acceptedAt?.toISOString()).toBe(OBSERVED);
  });

  test("a replacement run begun by a third party is never reported as this call's start", async () => {
    // The reviewer's interleaving, and the P2 on #2953. The adopted request's
    // recorded run closes, and the sweep — or the match fan-out — starts the
    // NEXT run for this Workflow id before this driver's own start lands.
    // USE_EXISTING hands that replacement back. The run differs from the one
    // the row records, which under the old predicate meant `started`: the
    // console would have told the operator their confirmation performed work
    // that a sandbox starter had begun.
    const otherDriver = armOtherDriver();
    beforeStart = async () => {
      expect(await otherDriverAccepts(otherDriver(), OBSERVED)).toBe("run-1");
      temporal.close(RECONCILE_ID, "completed");
      // A third party — no durable row, because it starts from inside the
      // Workflow sandbox — begins the replacement.
      const replacement = await startScoutPipelineReconciliationV2(
        temporal.client,
        RECONCILE_INPUT,
      );
      expect(replacement.firstExecutionRunId).toBe("run-2");
    };

    const result = await reconcile();

    // run-2 is running and this call reached it, having begun nothing.
    expect(result).toEqual({
      outcome: "reached-running",
      requestId: otherDriver(),
      requestedWorkflowId: RECONCILE_ID,
      runId: "run-2",
    });
    // Two starts reached Temporal and only the third party's created run-2;
    // this call's was joined onto it, which is why the fake recorded one.
    expect(temporal.starts).toHaveLength(2);
    expect(dispatcherStarts).toBe(1);
  });

  test("two dispatches for one Workflow id yield one run and no claim over it", async () => {
    const outcomes = await Promise.all([reconcile(), reconcile()]);

    // Exactly one execution, whatever order the two requests landed in, and
    // every answer names it. Neither answer says it began the run: one of
    // them did, the client cannot tell which, and two callers both answering
    // `started` was the false claim this vocabulary no longer permits.
    expect(temporal.starts).toHaveLength(1);
    for (const outcome of outcomes) {
      expect(["reached-running", "joined-running"]).toContain(outcome.outcome);
      if (
        outcome.outcome === "reached-running" ||
        outcome.outcome === "joined-running"
      ) {
        expect(outcome.runId).toBe("run-1");
      }
    }

    // The durable record agrees: every recorded request is accepted, and all
    // of them by that one run. Two requesters that both adopted the same
    // in-flight request leave one row; a requester that arrived after the
    // first acceptance leaves a second, joined to the same run.
    const rows = await rowsFor(RECONCILE_ID);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.length).toBeLessThanOrEqual(2);
    expect(rows.every((row) => row.runId === "run-1")).toBe(true);
    expect(new Set(rows.map((row) => row.requestId)).size).toBe(rows.length);
  });
});
