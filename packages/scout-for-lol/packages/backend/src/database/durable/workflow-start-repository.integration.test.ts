import { afterAll, describe, expect, test } from "vitest";
import {
  IsoInstantSchema,
  RiotMatchIdSchema,
  WorkflowRunIdSchema,
  WorkflowStartRequestIdSchema,
  type IsoInstant,
  type WorkflowRunId,
} from "@scout-for-lol/domain/identity/brands.ts";
import { DiscordAccountIdSchema } from "@scout-for-lol/domain/identity/discord.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import type {
  ScoutWorkflowStartRecord,
  ScoutWorkflowStartRequest,
} from "@scout-for-lol/domain/recovery/workflow-start.ts";
import {
  getWorkflowStart,
  recordWorkflowStartAccepted,
  requestWorkflowStart,
  type RequestWorkflowStartResult,
} from "#src/database/durable/workflow-start-repository.ts";
import {
  appendAuditEvent,
  listAuditEvents,
} from "#src/database/durable/audit-repository.ts";
import { scoutDurableWorkflowStartAcceptances } from "#src/metrics/durable-pipeline.ts";
import { matchTrackedAccountRowToRecord } from "#src/database/durable/tracked-account-row.ts";
import {
  listTrackedAccounts,
  markTrackedAccountCursorAdvanced,
  recordTrackedAccounts,
} from "#src/database/durable/tracked-account-repository.ts";

const { prisma } = createTestDatabase("durable-workflow-start-repository");

afterAll(async () => {
  await prisma.$disconnect();
});

const REQUESTED_AT = IsoInstantSchema.parse("2026-09-07T10:00:00.000Z");
const ACCEPTED_AT = IsoInstantSchema.parse("2026-09-07T10:01:00.000Z");
const RUN_ID = WorkflowRunIdSchema.parse("run-1");
const OPERATOR = DiscordAccountIdSchema.parse("200000000000000001");

function request(
  id: string,
  overrides: Partial<{ workflowType: string; requestSource: string }> = {},
): ScoutWorkflowStartRequest {
  const workflowType = overrides.workflowType ?? "match-recovery";
  return {
    requestedWorkflowId: id,
    workflowType,
    requestedBy: null,
    requestSource: overrides.requestSource ?? "operator-command",
    // The expected-kind contract: a start's input envelope kind IS its type.
    inputPayload: { kind: workflowType, version: 1, data: {} },
    requestedAt: REQUESTED_AT,
  };
}

function recorded(
  result: RequestWorkflowStartResult,
): ScoutWorkflowStartRecord {
  if (result.outcome === "conflict") {
    throw new Error(
      `Expected a recorded request, got ${JSON.stringify(result)}`,
    );
  }
  return result.record;
}

async function accept(
  record: ScoutWorkflowStartRecord,
  overrides: Partial<{
    runId: WorkflowRunId | null;
    acceptedAt: IsoInstant;
  }> = {},
) {
  return await recordWorkflowStartAccepted(prisma, {
    requestId: record.requestId,
    acceptedAt: overrides.acceptedAt ?? ACCEPTED_AT,
    runId: overrides.runId === undefined ? RUN_ID : overrides.runId,
  });
}

async function rowsFor(requestedWorkflowId: string) {
  return await prisma.scoutWorkflowStart.findMany({
    where: { requestedWorkflowId },
    orderBy: { createdAt: "asc" },
  });
}

describe("requestWorkflowStart", () => {
  test("records once and adopts the identical re-request while it is in flight", async () => {
    const first = await requestWorkflowStart(prisma, request("wf-req-1"));
    expect(first.outcome).toBe("applied");
    const record = recorded(first);
    expect(record).toEqual({
      requestId: record.requestId,
      ...request("wf-req-1"),
      acceptance: null,
    });
    expect(record.requestId).toMatch(/^[0-9a-f-]{36}$/u);

    // Who re-requests, and from where, is not part of the start's identity.
    const second = await requestWorkflowStart(
      prisma,
      request("wf-req-1", { requestSource: "test:retry" }),
    );
    expect(second).toEqual({
      outcome: "adopted",
      record,
      latestAccepted: null,
    });
    expect(await rowsFor("wf-req-1")).toHaveLength(1);
  });

  test("exactly one of two concurrent identical requests records; the other adopts it", async () => {
    const outcomes = await Promise.all([
      requestWorkflowStart(prisma, request("wf-req-2")),
      requestWorkflowStart(prisma, request("wf-req-2")),
    ]);
    expect(outcomes.map((result) => result.outcome).sort()).toEqual([
      "adopted",
      "applied",
    ]);
    const [a, b] = outcomes.map((result) => recorded(result));
    expect(a?.requestId).toBe(b?.requestId);
    expect(await rowsFor("wf-req-2")).toHaveLength(1);
  });

  test("conflicts when the same id is re-requested with different work", async () => {
    await requestWorkflowStart(prisma, request("wf-req-3"));
    expect(
      await requestWorkflowStart(
        prisma,
        request("wf-req-3", { workflowType: "hall-baseline" }),
      ),
    ).toEqual({ outcome: "conflict", reason: "request-differs" });
    expect(await rowsFor("wf-req-3")).toHaveLength(1);
  });

  test("a request after the previous one was accepted is a new request", async () => {
    const first = recorded(
      await requestWorkflowStart(prisma, request("wf-req-4")),
    );
    expect(await accept(first)).toEqual({ outcome: "applied" });

    const second = await requestWorkflowStart(prisma, request("wf-req-4"));
    expect(second.outcome).toBe("applied");
    if (second.outcome !== "applied") {
      throw new Error("unreachable");
    }
    expect(second.record.requestId).not.toBe(first.requestId);
    expect(second.record.acceptance).toBeNull();
    // The accepted predecessor travels with the answer, acceptance intact, so
    // a caller can tell a joined execution from a new run.
    expect(second.latestAccepted).toEqual({
      ...first,
      acceptance: { acceptedAt: ACCEPTED_AT, runId: RUN_ID },
    });
    expect(await rowsFor("wf-req-4")).toHaveLength(2);
  });

  test("a different start after an accepted one still conflicts", async () => {
    const first = recorded(
      await requestWorkflowStart(prisma, request("wf-req-4b")),
    );
    await accept(first);
    expect(
      await requestWorkflowStart(
        prisma,
        request("wf-req-4b", { workflowType: "hall-baseline" }),
      ),
    ).toEqual({ outcome: "conflict", reason: "request-differs" });
    expect(await rowsFor("wf-req-4b")).toHaveLength(1);
  });

  test("two simultaneous requests after an accepted one yield exactly one new request", async () => {
    const first = recorded(
      await requestWorkflowStart(prisma, request("wf-req-5")),
    );
    await accept(first);

    // Both read "nothing in flight" and both try to insert; the in-flight key
    // admits one, and the other adopts it as if the reads had been serial.
    const outcomes = await Promise.all([
      requestWorkflowStart(prisma, request("wf-req-5")),
      requestWorkflowStart(prisma, request("wf-req-5")),
    ]);
    expect(outcomes.map((result) => result.outcome).sort()).toEqual([
      "adopted",
      "applied",
    ]);
    const ids = new Set(outcomes.map((result) => recorded(result).requestId));
    expect(ids.size).toBe(1);
    expect(ids.has(first.requestId)).toBe(false);
    for (const outcome of outcomes) {
      if (outcome.outcome !== "conflict") {
        expect(outcome.latestAccepted?.requestId).toBe(first.requestId);
      }
    }
    expect(await rowsFor("wf-req-5")).toHaveLength(2);
  });

  test("two simultaneous requests with one acceptance each settle on exactly one accepted start", async () => {
    // The race the dispatcher runs end to end: both requesters ask, both hear
    // back from Temporal with the same run (the conflict policy joins), both
    // record acceptance. One row, accepted once.
    const outcomes = await Promise.all([
      requestWorkflowStart(prisma, request("wf-req-6")),
      requestWorkflowStart(prisma, request("wf-req-6")),
    ]);
    const records = outcomes.map((result) => recorded(result));
    const accepted = await Promise.all(records.map((r) => accept(r)));
    expect(accepted.map((result) => result.outcome).sort()).toEqual([
      "already-applied",
      "applied",
    ]);
    const rows = await rowsFor("wf-req-6");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.runId).toBe(RUN_ID);
  });
});

/**
 * A client whose `ScoutWorkflowStart.createMany` runs injected steps around
 * the real insert, so a test can place a concurrent winner exactly where the
 * race window is: in flight when the loser's insert runs, and accepted before
 * the loser reads again. Prisma's query extension is the seam; the steps run
 * against the plain client so they are not themselves intercepted.
 */
function withInsertHooks(hooks: {
  beforeInsert?: () => Promise<void>;
  afterInsert?: () => Promise<void>;
}) {
  let armed = true;
  return prisma.$extends({
    query: {
      scoutWorkflowStart: {
        async createMany({ args, query }) {
          if (!armed) {
            return await query(args);
          }
          armed = false;
          await hooks.beforeInsert?.();
          const result = await query(args);
          await hooks.afterInsert?.();
          return result;
        },
      },
    },
  });
}

describe("requestWorkflowStart under a lost insert", () => {
  test("adopts a winner that was accepted between the lost insert and the re-read", async () => {
    // Two operators confirm the same start at once. The winner records its
    // request while the loser is between its read and its insert, so the
    // loser's insert is refused; the winner then hears back from Temporal and
    // records acceptance before the loser reads again. The loser must resolve
    // to the winner's (now accepted) request — no throw, no second row.
    let winner: ScoutWorkflowStartRecord | undefined;
    const db = withInsertHooks({
      beforeInsert: async () => {
        winner = recorded(
          await requestWorkflowStart(prisma, request("wf-lost-1")),
        );
      },
      afterInsert: async () => {
        if (winner === undefined) throw new Error("winner missing");
        expect(await accept(winner)).toEqual({ outcome: "applied" });
      },
    });

    const loser = await requestWorkflowStart(db, request("wf-lost-1"));

    expect(loser.outcome).toBe("adopted");
    if (loser.outcome !== "adopted") throw new Error("unreachable");
    expect(loser.record.requestId).toBe(winner?.requestId);
    expect(loser.record.acceptance).toEqual({
      acceptedAt: ACCEPTED_AT,
      runId: RUN_ID,
    });
    expect(loser.latestAccepted?.requestId).toBe(winner?.requestId);
    expect(await rowsFor("wf-lost-1")).toHaveLength(1);
  });

  test("adopts a winner still in flight after the lost insert", async () => {
    let winner: ScoutWorkflowStartRecord | undefined;
    const db = withInsertHooks({
      beforeInsert: async () => {
        winner = recorded(
          await requestWorkflowStart(prisma, request("wf-lost-2")),
        );
      },
    });
    const loser = await requestWorkflowStart(db, request("wf-lost-2"));
    expect(loser.outcome).toBe("adopted");
    if (loser.outcome !== "adopted") throw new Error("unreachable");
    expect(loser.record).toEqual(winner);
    expect(await rowsFor("wf-lost-2")).toHaveLength(1);
  });

  test("gives up loudly when refusals are never explained by the re-read", async () => {
    // Only reachable if the insert is refused while nothing is in flight and
    // nothing new was accepted — a broken invariant, not contention — and
    // then only after the bounded retries, never by looping forever.
    // Every attempt is refused, and nothing ever changes underneath.
    const stubborn = prisma.$extends({
      query: {
        scoutWorkflowStart: {
          createMany: () => Promise.resolve({ count: 0 }),
        },
      },
    });
    await expect(
      requestWorkflowStart(stubborn, request("wf-lost-3")),
    ).rejects.toThrow(/Gave up recording a start/u);
    expect(await rowsFor("wf-lost-3")).toHaveLength(0);
  });
});

/**
 * One acceptance series' current value, zero when the series does not exist.
 *
 * Absent and zero mean the same thing to this file's assertions, which compare
 * a delta rather than an absolute: the registry is process-wide and other
 * suites in the same worker write these same series.
 */
async function seriesValue(outcome: string): Promise<number> {
  const metric = await scoutDurableWorkflowStartAcceptances.get();
  return (
    metric.values.find((value) => value.labels.outcome === outcome)?.value ?? 0
  );
}

describe("recordWorkflowStartAccepted", () => {
  test("accepts once, answers the same run again, and never overwrites", async () => {
    const record = recorded(
      await requestWorkflowStart(prisma, request("wf-acc-1")),
    );
    expect(await accept(record)).toEqual({ outcome: "applied" });
    expect(await accept(record)).toEqual({ outcome: "already-applied" });
    // A second driver of this request heard the same run a moment later. The
    // instant it observed is not what the acceptance attests to.
    expect(
      await accept(record, {
        acceptedAt: IsoInstantSchema.parse("2026-09-07T10:01:00.004Z"),
      }),
    ).toEqual({ outcome: "already-applied" });
    // A DIFFERENT run is a different answer, and the recorded one stands.
    expect(
      await accept(record, { runId: WorkflowRunIdSchema.parse("run-2") }),
    ).toEqual({
      outcome: "answered-by-another-run",
      accepted: { acceptedAt: ACCEPTED_AT, runId: RUN_ID },
    });
    const stored = await getWorkflowStart(prisma, {
      requestedWorkflowId: record.requestedWorkflowId,
    });
    expect(stored?.acceptance).toEqual({
      acceptedAt: ACCEPTED_AT,
      runId: RUN_ID,
    });
  });

  test("counts the run-disagreement the soak is watching for", async () => {
    // The branch itself, not a hand-rolled `inc`: the counter exists to tell a
    // soak whether this interleaving ever happens, so what has to be pinned is
    // that reaching it moves the series. A test that incremented the counter
    // directly would pass with the repository uninstrumented.
    const before = await seriesValue("answered-by-another-run");
    const appliedBefore = await seriesValue("applied");

    const record = recorded(
      await requestWorkflowStart(prisma, request("wf-acc-counted")),
    );
    expect(await accept(record)).toEqual({ outcome: "applied" });
    expect(
      await accept(record, { runId: WorkflowRunIdSchema.parse("run-other") }),
    ).toMatchObject({ outcome: "answered-by-another-run" });

    expect(await seriesValue("answered-by-another-run")).toBe(before + 1);
    // The ordinary answer is counted too, which is what makes a flat rare
    // series readable as "it did not happen" rather than "nothing is wired".
    expect(await seriesValue("applied")).toBe(appliedBefore + 1);
  });

  test("accepting a request that was never recorded fails loudly", async () => {
    await expect(
      recordWorkflowStartAccepted(prisma, {
        requestId: WorkflowStartRequestIdSchema.parse(
          "00000000-0000-4000-8000-000000000000",
        ),
        acceptedAt: ACCEPTED_AT,
        runId: null,
      }),
    ).rejects.toThrow(/never requested/);
  });

  test("exactly one of two concurrent acceptances applies", async () => {
    const record = recorded(
      await requestWorkflowStart(prisma, request("wf-acc-race")),
    );
    const runIds = [
      WorkflowRunIdSchema.parse("run-x"),
      WorkflowRunIdSchema.parse("run-y"),
    ];
    const outcomes = await Promise.all(
      runIds.map((runId) => accept(record, { runId })),
    );
    expect(outcomes.map((result) => result.outcome).sort()).toEqual([
      "answered-by-another-run",
      "applied",
    ]);

    // The stored run id is the one whose acceptance applied.
    const appliedIndex = outcomes.findIndex(
      (result) => result.outcome === "applied",
    );
    const stored = await getWorkflowStart(prisma, {
      requestedWorkflowId: record.requestedWorkflowId,
    });
    expect(stored?.acceptance?.runId).toBe(runIds[appliedIndex]);
  });

  test("a delayed acceptance for a superseded request lands on that request, never its successor", async () => {
    const first = recorded(
      await requestWorkflowStart(prisma, request("wf-acc-late")),
    );
    await accept(first);
    const second = recorded(
      await requestWorkflowStart(prisma, request("wf-acc-late")),
    );

    // A retry of the first acceptance arrives after the second request exists.
    // Keyed by request, it replays against the first and leaves the second
    // untouched; keyed by workflow id it would have accepted the wrong one.
    expect(await accept(first)).toEqual({ outcome: "already-applied" });
    expect(
      await accept(first, { runId: WorkflowRunIdSchema.parse("run-other") }),
    ).toEqual({
      outcome: "answered-by-another-run",
      accepted: { acceptedAt: ACCEPTED_AT, runId: RUN_ID },
    });
    const current = await getWorkflowStart(prisma, {
      requestedWorkflowId: "wf-acc-late",
    });
    expect(current?.requestId).toBe(second.requestId);
    expect(current?.acceptance).toBeNull();
  });
});

describe("getWorkflowStart", () => {
  test("answers the in-flight request, else the latest accepted, else null", async () => {
    expect(
      await getWorkflowStart(prisma, { requestedWorkflowId: "wf-get" }),
    ).toBeNull();

    const first = recorded(
      await requestWorkflowStart(prisma, request("wf-get")),
    );
    await accept(first, {
      runId: WorkflowRunIdSchema.parse("run-a"),
      acceptedAt: IsoInstantSchema.parse("2026-09-07T10:01:00.000Z"),
    });
    const second = recorded(
      await requestWorkflowStart(prisma, request("wf-get")),
    );
    await accept(second, {
      runId: WorkflowRunIdSchema.parse("run-b"),
      acceptedAt: IsoInstantSchema.parse("2026-09-07T10:02:00.000Z"),
    });
    const latest = await getWorkflowStart(prisma, {
      requestedWorkflowId: "wf-get",
    });
    expect(latest?.requestId).toBe(second.requestId);
    expect(latest?.acceptance?.runId).toBe("run-b");

    const third = recorded(
      await requestWorkflowStart(prisma, request("wf-get")),
    );
    const inFlight = await getWorkflowStart(prisma, {
      requestedWorkflowId: "wf-get",
    });
    expect(inFlight?.requestId).toBe(third.requestId);
    expect(inFlight?.acceptance).toBeNull();
  });
});

describe("appendAuditEvent", () => {
  test("appends and lists events in insertion order", async () => {
    const first = await appendAuditEvent(prisma, {
      actorDiscordId: OPERATOR,
      action: "recovery-policy-released",
      subjectKind: "recovery-batch",
      subjectId: "rb-1",
      detail: { from: "no-external", to: "stale-private-only" },
    });
    const second = await appendAuditEvent(prisma, {
      actorDiscordId: OPERATOR,
      action: "unknown-delivery-resolved",
      subjectKind: "recovery-batch",
      subjectId: "rb-1",
      detail: { outcome: "confirmed-unsent" },
    });
    expect(second.id).toBeGreaterThan(first.id);

    const listed = await listAuditEvents(prisma, {
      subjectKind: "recovery-batch",
      subjectId: "rb-1",
    });
    expect(listed.map((event) => event.action)).toEqual([
      "recovery-policy-released",
      "unknown-delivery-resolved",
    ]);
    expect(listed[0]?.detail).toEqual({
      from: "no-external",
      to: "stale-private-only",
    });
  });

  test("a replayed idempotency key returns the original event", async () => {
    const input = {
      actorDiscordId: OPERATOR,
      action: "batch-created",
      subjectKind: "recovery-batch",
      subjectId: "rb-idem",
      detail: { policy: "no-external" },
      idempotencyKey: "rb-idem-create",
    };
    const first = await appendAuditEvent(prisma, input);
    const replay = await appendAuditEvent(prisma, input);
    expect(replay).toEqual(first);

    const listed = await listAuditEvents(prisma, {
      subjectKind: "recovery-batch",
      subjectId: "rb-idem",
    });
    expect(listed).toHaveLength(1);
  });

  test("the Zod guard rejects a detail JSON.stringify would silently corrupt", async () => {
    // NaN survives JSON.stringify (it becomes null), so a rejection here can
    // only come from the z.json() guard — not from serialization failing.
    await expect(
      appendAuditEvent(prisma, {
        actorDiscordId: OPERATOR,
        action: "x",
        subjectKind: "y",
        subjectId: "z",
        detail: { value: Number.NaN },
      }),
    ).rejects.toThrow();
  });
});

describe("tracked accounts", () => {
  const association = matchTrackedAccountRowToRecord({
    riotMatchId: "NA1_7000",
    puuid: "q".repeat(78),
    playerId: null,
    accountId: null,
    cursorAdvancedAt: null,
  });

  test("records idempotently and advances the cursor exactly once", async () => {
    expect(await recordTrackedAccounts(prisma, [association])).toEqual({
      recorded: 1,
      existing: 0,
    });
    expect(await recordTrackedAccounts(prisma, [association])).toEqual({
      recorded: 0,
      existing: 1,
    });

    const advance = {
      matchId: association.matchId,
      puuid: association.puuid,
      advancedAt: ACCEPTED_AT,
    };
    expect(await markTrackedAccountCursorAdvanced(prisma, advance)).toEqual({
      outcome: "applied",
    });
    expect(await markTrackedAccountCursorAdvanced(prisma, advance)).toEqual({
      outcome: "already-applied",
    });

    const listed = await listTrackedAccounts(prisma, {
      matchId: association.matchId,
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.cursorAdvancedAt).toBe(ACCEPTED_AT);
  });

  test("advancing an unrecorded association fails loudly", async () => {
    await expect(
      markTrackedAccountCursorAdvanced(prisma, {
        matchId: RiotMatchIdSchema.parse("NA1_7001"),
        puuid: association.puuid,
        advancedAt: ACCEPTED_AT,
      }),
    ).rejects.toThrow(/never recorded/);
  });

  test("a delayed retry with an earlier timestamp cannot rewind the cursor", async () => {
    const row = matchTrackedAccountRowToRecord({
      riotMatchId: "NA1_7002",
      puuid: "s".repeat(78),
      playerId: null,
      accountId: null,
      cursorAdvancedAt: null,
    });
    await recordTrackedAccounts(prisma, [row]);

    const earlier = IsoInstantSchema.parse("2026-09-07T09:00:00.000Z");
    const later = IsoInstantSchema.parse("2026-09-07T10:00:00.000Z");
    expect(
      await markTrackedAccountCursorAdvanced(prisma, {
        matchId: row.matchId,
        puuid: row.puuid,
        advancedAt: later,
      }),
    ).toEqual({ outcome: "applied" });
    expect(
      await markTrackedAccountCursorAdvanced(prisma, {
        matchId: row.matchId,
        puuid: row.puuid,
        advancedAt: earlier,
      }),
    ).toEqual({ outcome: "already-applied" });

    const listed = await listTrackedAccounts(prisma, { matchId: row.matchId });
    expect(listed[0]?.cursorAdvancedAt).toBe(later);
  });

  test("concurrent advances settle at the latest timestamp", async () => {
    const row = matchTrackedAccountRowToRecord({
      riotMatchId: "NA1_7003",
      puuid: "t".repeat(78),
      playerId: null,
      accountId: null,
      cursorAdvancedAt: null,
    });
    await recordTrackedAccounts(prisma, [row]);

    const earlier = IsoInstantSchema.parse("2026-09-07T09:00:00.000Z");
    const later = IsoInstantSchema.parse("2026-09-07T10:00:00.000Z");
    const outcomes = await Promise.all([
      markTrackedAccountCursorAdvanced(prisma, {
        matchId: row.matchId,
        puuid: row.puuid,
        advancedAt: earlier,
      }),
      markTrackedAccountCursorAdvanced(prisma, {
        matchId: row.matchId,
        puuid: row.puuid,
        advancedAt: later,
      }),
    ]);
    // Either ordering applies the later advance; the earlier one either lands
    // first and is overtaken, or arrives second and is refused. The cursor
    // never ends up rewound.
    expect(
      outcomes.filter((result) => result.outcome === "applied").length,
    ).toBeGreaterThanOrEqual(1);
    const listed = await listTrackedAccounts(prisma, { matchId: row.matchId });
    expect(listed[0]?.cursorAdvancedAt).toBe(later);
  });

  test("a mixed batch reports newly recorded and existing associations", async () => {
    const matchId = "NA1_7004";
    const rows = Array.from({ length: 10 }, (_, index) =>
      matchTrackedAccountRowToRecord({
        riotMatchId: matchId,
        puuid: String(index).repeat(78).slice(0, 78),
        playerId: null,
        accountId: null,
        cursorAdvancedAt: null,
      }),
    );
    expect(await recordTrackedAccounts(prisma, rows.slice(0, 6))).toEqual({
      recorded: 6,
      existing: 0,
    });
    expect(await recordTrackedAccounts(prisma, rows)).toEqual({
      recorded: 4,
      existing: 6,
    });
    const listed = await listTrackedAccounts(prisma, {
      matchId: rows[0]?.matchId ?? RiotMatchIdSchema.parse(matchId),
    });
    expect(listed).toHaveLength(10);
    expect(listed.map((entry) => entry.puuid)).toEqual(
      rows.map((entry) => entry.puuid).sort((a, b) => a.localeCompare(b)),
    );
  });
});
