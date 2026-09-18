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

/**
 * The operator dispatch against a real durable table and a modelled Temporal.
 *
 * The properties under test are the ones SJ-205 changed: the same Workflow id
 * can be requested again and again, each request has its own key, and the
 * answer says what THIS request did — began a run, joined one, was refused, or
 * is waiting for Temporal — never what an earlier request did.
 *
 * Module mocks must be installed before the dispatcher is imported, so it is
 * imported dynamically below them.
 */

const { prisma } = createTestDatabase("operations-workflow-dispatch");
vi.doMock("#src/database/index.ts", () => ({ ...databaseModule, prisma }));

let temporal: FakeV2Temporal = fakeV2Temporal();
let available = true;
vi.doMock("#src/temporal/runtime.ts", () => ({
  currentScoutTemporalSupervisor: () =>
    available ? { client: () => temporal.client } : undefined,
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
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("one request, one run", () => {
  test("records the request, starts the run, and records the acceptance on that request", async () => {
    const result = await reconcile();
    expect(result).toEqual({
      outcome: "started",
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

  test("after the run closed, a second request begins a new run", async () => {
    // The repeat operator reconcile from the beta acceptance checklist: one
    // sweep per stage forever was the SJ-205 defect.
    const first = await reconcile();
    temporal.close(RECONCILE_ID, "completed");

    const second = await reconcile();

    expect(second).toEqual({
      outcome: "started",
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
    expect(second.outcome).toBe("started");
    expect(temporal.starts).toHaveLength(2);
  });
});

describe("Temporal unavailable", () => {
  test("the request is recorded unaccepted; asking again once reachable adopts it and starts", async () => {
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
      outcome: "started",
      requestId: waiting.requestId,
      requestedWorkflowId: RECONCILE_ID,
      runId: "run-1",
    });
    expect(await rowsFor(RECONCILE_ID)).toHaveLength(1);
  });
});

describe("simultaneous requests", () => {
  test("two dispatches for one Workflow id yield exactly one run and one accepted start", async () => {
    const outcomes = await Promise.all([reconcile(), reconcile()]);

    // Exactly one execution began, whatever order the two requests landed
    // in; every answer names it, and none claims a second one.
    expect(temporal.starts).toHaveLength(1);
    for (const outcome of outcomes) {
      expect(["started", "joined-running"]).toContain(outcome.outcome);
      if (
        outcome.outcome === "started" ||
        outcome.outcome === "joined-running"
      ) {
        expect(outcome.runId).toBe("run-1");
      }
    }
    expect(
      outcomes.filter((outcome) => outcome.outcome === "started").length,
    ).toBeGreaterThanOrEqual(1);

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
