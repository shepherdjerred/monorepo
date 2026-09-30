import { describe, expect, test } from "vitest";
import {
  appendOperationsPage,
  EMPTY_OPERATIONS_FILTER,
  filterOperationsQueues,
  operationsQueues,
  operationsRowCount,
  type OperationsQueuesData,
} from "#src/lib/operations/operations-queues.ts";

const MATCH_A = "NA1_1111111111";
const MATCH_B = "EUW1_2222222222";
const UNKNOWN_INTENT_KEY = "match:EUW1_2222222222/dm:42";

/** The moment the fixture rows were read. */
const NOW = Date.parse("2026-09-14T12:00:00.000Z");
const FUTURE = "2026-09-14T12:30:00.000Z";
const PAST = "2026-09-14T11:30:00.000Z";

const NO_PAGES = {
  stalledMatchProcessing: { hasMore: false, cursor: null },
  stalledNotifications: { hasMore: false, cursor: null },
  unknownDeliveries: { hasMore: false, cursor: null },
  unprojectedMatches: { hasMore: false, cursor: null },
  liveRecoveryBatches: { hasMore: false, cursor: null },
  unacceptedWorkflowStarts: { hasMore: false, cursor: null },
} as const;

function notification(
  intentKey: string,
  state: string,
  freshnessDeadline: string,
) {
  return {
    intentKey,
    matchId: MATCH_A,
    state,
    freshnessDeadline,
    attemptCount: 1,
  };
}

const QUEUES: OperationsQueuesData = {
  stalledMatchProcessing: [MATCH_A],
  stalledNotifications: [notification("intent-fresh", "ready", FUTURE)],
  unknownDeliveries: [
    {
      intentKey: UNKNOWN_INTENT_KEY,
      matchId: MATCH_B,
      attemptCount: 2,
      attemptNonce: "attempt-3",
      state: "unknown-delivery",
    },
  ],
  unprojectedMatches: [MATCH_B],
  liveRecoveryBatches: ["batch-7"],
  unacceptedWorkflowStarts: [
    {
      requestedWorkflowId: "scout-recon-beta-operator",
      workflowType: "scoutPipelineReconciliationV2",
      requestedAt: "2026-09-14T09:00:00.000Z",
      requestSource: "operations:reconcile-pipeline",
    },
  ],
  pages: NO_PAGES,
};

function notificationRow(state: string, freshnessDeadline: string) {
  return operationsQueues(
    {
      ...QUEUES,
      stalledNotifications: [notification("i", state, freshnessDeadline)],
    },
    NOW,
  )[1]?.rows[0];
}

describe("projecting the reads", () => {
  test("draws all six queues, in a stable order, each naming its API page", () => {
    const queues = operationsQueues(QUEUES, NOW);
    expect(queues.map((queue) => queue.id)).toEqual([
      "stalled-matches",
      "stalled-notifications",
      "unknown-deliveries",
      "unprojected-matches",
      "recovery-batches",
      "unaccepted-starts",
    ]);
    expect(queues.map((queue) => queue.source)).toEqual([
      "stalledMatchProcessing",
      "stalledNotifications",
      "unknownDeliveries",
      "unprojectedMatches",
      "liveRecoveryBatches",
      "unacceptedWorkflowStarts",
    ]);
  });

  test("offers each row only the arms that row can actually start", () => {
    const byId = new Map(
      operationsQueues(QUEUES, NOW).map((queue) => [queue.id, queue]),
    );

    expect(
      byId.get("unprojected-matches")?.rows[0]?.drafts.map((d) => d.kind),
    ).toEqual(["ops_repair_projection"]);
    expect(
      byId.get("recovery-batches")?.rows[0]?.drafts.map((d) => d.kind),
    ).toEqual(["ops_release_recovery_policy"]);

    expect(byId.get("unknown-deliveries")?.rows[0]?.drafts).toEqual([
      {
        kind: "ops_resolve_unknown_delivery",
        intentKey: UNKNOWN_INTENT_KEY,
        attemptNonce: "attempt-3",
        outcome: "not-delivered",
        messageId: "",
        deliveredAt: "",
      },
    ]);

    // Nothing re-drives a stalled match row directly; reconciliation does.
    expect(byId.get("stalled-matches")?.rows[0]?.drafts).toEqual([]);
    // And an unaccepted start is evidence, not a control.
    expect(byId.get("unaccepted-starts")?.rows[0]?.drafts).toEqual([]);
  });
});

describe("stalled notifications offer only what can succeed", () => {
  test("a fresh drivable intent offers a re-drive and no suppression", () => {
    // This read bounds the deadline to the future, so suppression would always
    // answer not-stale. The row proves that, rather than the console assuming
    // it from a WHERE clause it does not own.
    for (const state of ["pending", "ready"] as const) {
      const row = notificationRow(state, FUTURE);
      expect(row?.blocked).toBeNull();
      expect(row?.drafts.map((draft) => draft.kind)).toEqual([
        "ops_retry_notification",
      ]);
    }
  });

  test("a genuinely stale intent flips to suppression and drops the re-drive", () => {
    // Unreachable through today's query, and decided on the row's own evidence
    // so a later relaxation of that bound is handled rather than missed.
    expect(
      notificationRow("ready", PAST)?.drafts.map((draft) => draft.kind),
    ).toEqual(["ops_suppress_stale_notification"]);
  });

  test("the deadline boundary is judged against the read's own clock", () => {
    // At the deadline the machine already refuses the send, so the row is
    // stale rather than fresh.
    expect(
      notificationRow("ready", new Date(NOW).toISOString())?.drafts.map(
        (draft) => draft.kind,
      ),
    ).toEqual(["ops_suppress_stale_notification"]);
  });

  test("a sending intent offers nothing and says why", () => {
    const row = notificationRow("sending", FUTURE);
    expect(row?.drafts).toEqual([]);
    expect(row?.blocked?.tone).toBe("rule");
    expect(row?.blocked?.message).toContain("cannot be re-driven");
    // Not phrased as an available action: the intent has to reach
    // unknown-delivery before anyone can answer it.
    expect(row?.blocked?.message).toContain(
      "recorded as unknown and then answered",
    );
  });

  test("an unrecognised state is reported as a contract violation, loudly", () => {
    // Backend and SPA ship as one release, so a state this console cannot
    // reason about means they went out of step — an incident, not a detail.
    const row = notificationRow("brand-new", FUTURE);
    expect(row?.drafts).toEqual([]);
    expect(row?.blocked?.tone).toBe("contract-violation");
    expect(row?.blocked?.message).toContain("Unrecognised state: brand-new");
    expect(row?.blocked?.message).toContain("contract violation");
    expect(row?.blocked?.message).toContain("report it");
  });
});

describe("paging", () => {
  const paged: OperationsQueuesData = {
    ...QUEUES,
    pages: {
      ...NO_PAGES,
      stalledNotifications: { hasMore: true, cursor: "c1" },
    },
  };

  test("a queue carries its own hasMore and cursor", () => {
    const queues = operationsQueues(paged, NOW);
    expect(queues[1]?.hasMore).toBe(true);
    expect(queues[1]?.cursor).toBe("c1");
    expect(queues[0]?.hasMore).toBe(false);
    expect(queues[0]?.cursor).toBeNull();
  });

  test("appending a page extends only that queue", () => {
    const next: OperationsQueuesData = {
      ...QUEUES,
      // A cursored request still re-reads every other queue's first page.
      stalledMatchProcessing: ["NA1_9999999999"],
      stalledNotifications: [notification("intent-page-2", "ready", FUTURE)],
      pages: NO_PAGES,
    };
    const merged = appendOperationsPage(paged, "stalledNotifications", next);

    expect(merged.stalledNotifications.map((row) => row.intentKey)).toEqual([
      "intent-fresh",
      "intent-page-2",
    ]);
    expect(merged.pages.stalledNotifications).toEqual({
      hasMore: false,
      cursor: null,
    });
    // The other queues keep what they had rather than being rewound by a
    // response that re-read their first page.
    expect(merged.stalledMatchProcessing).toEqual([MATCH_A]);
  });
});

describe("filtering", () => {
  const queues = operationsQueues(QUEUES, NOW);

  test("shows everything, including empty queues, by default", () => {
    const empty = operationsQueues(
      {
        stalledMatchProcessing: [],
        stalledNotifications: [],
        unknownDeliveries: [],
        unprojectedMatches: [],
        liveRecoveryBatches: [],
        unacceptedWorkflowStarts: [],
        pages: NO_PAGES,
      },
      NOW,
    );
    expect(filterOperationsQueues(empty, EMPTY_OPERATIONS_FILTER)).toHaveLength(
      6,
    );
    expect(operationsRowCount(queues)).toBe(6);
  });

  test("narrows to one queue", () => {
    expect(
      filterOperationsQueues(queues, {
        ...EMPTY_OPERATIONS_FILTER,
        queue: "recovery-batches",
      }).map((queue) => queue.id),
    ).toEqual(["recovery-batches"]);
  });

  test("stalled-only drops the queue of work still in flight", () => {
    const filtered = filterOperationsQueues(queues, {
      ...EMPTY_OPERATIONS_FILTER,
      stalledOnly: true,
    });
    expect(filtered.map((queue) => queue.id)).not.toContain("recovery-batches");
    expect(filtered).toHaveLength(5);
  });

  test("a paged queue survives a search that matches none of its loaded rows", () => {
    // The console has only searched what it pulled. Dropping the panel would
    // remove the one control that could reach the row being searched for, and
    // would present a partial search as a finished one.
    const paged = operationsQueues(
      {
        ...QUEUES,
        pages: {
          ...NO_PAGES,
          stalledNotifications: { hasMore: true, cursor: "c1" },
        },
      },
      NOW,
    );
    const filtered = filterOperationsQueues(paged, {
      ...EMPTY_OPERATIONS_FILTER,
      search: "nothing-like-this",
    });

    expect(filtered.map((queue) => queue.id)).toEqual([
      "stalled-notifications",
    ]);
    expect(filtered[0]?.rows).toEqual([]);
    expect(filtered[0]?.hasMore).toBe(true);
    expect(filtered[0]?.cursor).toBe("c1");
    // How many were actually looked at survives the filter, so the empty copy
    // can say it rather than implying the queue was searched to the end.
    expect(filtered[0]?.loadedCount).toBe(1);
  });

  test("a queue with nothing further to load still collapses", () => {
    // That answer is complete: every row it will ever have was searched.
    expect(
      filterOperationsQueues(queues, {
        ...EMPTY_OPERATIONS_FILTER,
        search: "nothing-like-this",
      }),
    ).toEqual([]);
  });

  test("loading more under an active search re-filters the grown set", () => {
    const paged: OperationsQueuesData = {
      ...QUEUES,
      pages: {
        ...NO_PAGES,
        stalledNotifications: { hasMore: true, cursor: "c1" },
      },
    };
    const search = { ...EMPTY_OPERATIONS_FILTER, search: "intent-page-2" };

    // Nothing matches yet, but the panel stays so the operator can page on.
    expect(
      filterOperationsQueues(operationsQueues(paged, NOW), search)[0]?.rows,
    ).toEqual([]);

    const grown = appendOperationsPage(paged, "stalledNotifications", {
      ...QUEUES,
      stalledNotifications: [notification("intent-page-2", "ready", FUTURE)],
      pages: NO_PAGES,
    });
    const after = filterOperationsQueues(operationsQueues(grown, NOW), search);

    expect(after[0]?.rows.map((row) => row.primary)).toEqual(["intent-page-2"]);
    expect(after[0]?.loadedCount).toBe(2);
    // Exhausted now, so the control goes away with the backlog.
    expect(after[0]?.hasMore).toBe(false);
  });

  test("a search matches identifiers and detail, and hides what it misses", () => {
    const filtered = filterOperationsQueues(queues, {
      ...EMPTY_OPERATIONS_FILTER,
      search: "euw1_2222222222",
    });
    expect(filtered.map((queue) => queue.id)).toEqual([
      "unknown-deliveries",
      "unprojected-matches",
    ]);
    expect(operationsRowCount(filtered)).toBe(2);
  });
});
