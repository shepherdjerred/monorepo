import { afterAll, describe, expect, test } from "vitest";
import {
  IsoInstantSchema,
  RiotMatchIdSchema,
  WorkflowRunIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import { DiscordAccountIdSchema } from "@scout-for-lol/domain/identity/discord.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  scoutWorkflowStartRowToRecord,
  type ScoutWorkflowStartRecord,
} from "#src/database/durable/workflow-start-row.ts";
import {
  getWorkflowStart,
  recordWorkflowStartAccepted,
  requestWorkflowStart,
} from "#src/database/durable/workflow-start-repository.ts";
import {
  appendAuditEvent,
  listAuditEvents,
} from "#src/database/durable/audit-repository.ts";
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

const AT = new Date("2026-09-07T10:00:00.000Z");
const ACCEPTED_AT = IsoInstantSchema.parse("2026-09-07T10:01:00.000Z");
const RUN_ID = WorkflowRunIdSchema.parse("run-1");
const OPERATOR = DiscordAccountIdSchema.parse("200000000000000001");

function request(
  id: string,
  overrides: Partial<{ workflowType: string }> = {},
): ScoutWorkflowStartRecord {
  const workflowType = overrides.workflowType ?? "match-recovery";
  return scoutWorkflowStartRowToRecord({
    requestedWorkflowId: id,
    workflowType,
    requestedBy: null,
    requestSource: "operator-command",
    // The expected-kind contract: a start's input envelope kind IS its type.
    inputPayload: JSON.stringify({ kind: workflowType, version: 1, data: {} }),
    requestedAt: AT,
    acceptedAt: null,
    runId: null,
  });
}

describe("requestWorkflowStart", () => {
  test("inserts once and adopts the identical re-request", async () => {
    const record = request("wf-req-1");
    const first = await requestWorkflowStart(prisma, record);
    expect(first.outcome).toBe("applied");
    const second = await requestWorkflowStart(prisma, record);
    expect(second).toEqual({ outcome: "adopted", record });
  });

  test("exactly one of two concurrent identical requests inserts, the other adopts", async () => {
    const record = request("wf-req-2");
    const outcomes = await Promise.all([
      requestWorkflowStart(prisma, record),
      requestWorkflowStart(prisma, record),
    ]);
    expect(outcomes.map((result) => result.outcome).sort()).toEqual([
      "adopted",
      "applied",
    ]);
  });

  test("conflicts when the same id is re-requested with different work", async () => {
    await requestWorkflowStart(prisma, request("wf-req-3"));
    expect(
      await requestWorkflowStart(
        prisma,
        request("wf-req-3", { workflowType: "hall-baseline" }),
      ),
    ).toEqual({ outcome: "conflict", reason: "request-differs" });
  });

  test("adoption returns the recorded acceptance", async () => {
    const record = request("wf-req-4");
    await requestWorkflowStart(prisma, record);
    await recordWorkflowStartAccepted(prisma, {
      requestedWorkflowId: record.requestedWorkflowId,
      acceptedAt: ACCEPTED_AT,
      runId: RUN_ID,
    });
    const adopted = await requestWorkflowStart(prisma, record);
    expect(adopted.outcome).toBe("adopted");
    if (adopted.outcome === "adopted") {
      expect(adopted.record.acceptance).toEqual({
        acceptedAt: ACCEPTED_AT,
        runId: RUN_ID,
      });
    }
  });
});

describe("recordWorkflowStartAccepted", () => {
  test("accepts once, tolerates the identical retry, conflicts on drift", async () => {
    const record = request("wf-acc-1");
    await requestWorkflowStart(prisma, record);
    const args = {
      requestedWorkflowId: record.requestedWorkflowId,
      acceptedAt: ACCEPTED_AT,
      runId: RUN_ID,
    };
    expect(await recordWorkflowStartAccepted(prisma, args)).toEqual({
      outcome: "applied",
    });
    expect(await recordWorkflowStartAccepted(prisma, args)).toEqual({
      outcome: "already-applied",
    });
    expect(
      await recordWorkflowStartAccepted(prisma, {
        ...args,
        runId: WorkflowRunIdSchema.parse("run-2"),
      }),
    ).toEqual({ outcome: "conflict", reason: "acceptance-differs" });
    const stored = await getWorkflowStart(prisma, {
      requestedWorkflowId: record.requestedWorkflowId,
    });
    expect(stored?.acceptance?.runId).toBe(RUN_ID);
  });

  test("accepting a start that was never requested fails loudly", async () => {
    await expect(
      recordWorkflowStartAccepted(prisma, {
        requestedWorkflowId: "wf-ghost",
        acceptedAt: ACCEPTED_AT,
        runId: null,
      }),
    ).rejects.toThrow(/never requested/);
  });

  test("exactly one of two concurrent acceptances applies", async () => {
    const record = request("wf-acc-race");
    await requestWorkflowStart(prisma, record);
    const runIds = [
      WorkflowRunIdSchema.parse("run-x"),
      WorkflowRunIdSchema.parse("run-y"),
    ];
    const outcomes = await Promise.all(
      runIds.map((runId) =>
        recordWorkflowStartAccepted(prisma, {
          requestedWorkflowId: record.requestedWorkflowId,
          acceptedAt: ACCEPTED_AT,
          runId,
        }),
      ),
    );
    expect(outcomes.map((result) => result.outcome).sort()).toEqual([
      "applied",
      "conflict",
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
