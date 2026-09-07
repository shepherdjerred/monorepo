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
  return scoutWorkflowStartRowToRecord({
    requestedWorkflowId: id,
    workflowType: "match-recovery",
    requestedBy: null,
    requestSource: "operator-command",
    inputPayload: JSON.stringify({ kind: "recovery", version: 1, data: {} }),
    requestedAt: AT,
    acceptedAt: null,
    runId: null,
    ...overrides,
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

  test("rejects a detail that cannot be serialized as JSON", async () => {
    await expect(
      appendAuditEvent(prisma, {
        actorDiscordId: OPERATOR,
        action: "x",
        subjectKind: "y",
        subjectId: "z",
        detail: { bad: 1n },
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
});
