import {
  notificationActions,
  type NotificationBlocked,
} from "#src/lib/operations/operations-notification-actions.ts";
import {
  resolveDeliveryDraft,
  type OperationsRequestDraft,
} from "#src/lib/operations/operations-payloads.ts";

/**
 * The six operations reads, projected into something a human can scan.
 *
 * The shape below is structural rather than the tRPC output type so the
 * projection can be tested without a client; the real query data assigns to it,
 * and a change to what the reads return fails at the call site.
 *
 * What a row can DO is decided here rather than in the renderer, because the
 * answer is a property of the read. An unknown delivery is the clearest case:
 * the domain only lets an operator answer the ATTEMPT they investigated, and
 * this read names it — so the row offers the answer bound to that attempt, and
 * shows the nonce rather than merely carrying it, because an operator who
 * cannot see which attempt they are answering is not answering one knowingly.
 *
 * Owner and policy are deliberately absent from every row. They are per-match
 * facts from `matchPipeline`, not columns these queue reads return, and a
 * filter that pretended otherwise would be filtering on nothing.
 */

export type OperationsQueuesData = {
  readonly stalledMatchProcessing: readonly string[];
  readonly stalledNotifications: readonly {
    readonly intentKey: string;
    readonly matchId: string;
    readonly state: string;
    readonly freshnessDeadline: string;
    readonly attemptCount: number;
  }[];
  readonly unknownDeliveries: readonly {
    readonly intentKey: string;
    readonly matchId: string;
    readonly attemptCount: number;
    /**
     * The attempt whose outcome was never observed. Required, because the read
     * narrows it off the `unknown-delivery` state and treats any other state on
     * that queue as a broken repository contract — so a row without one does
     * not reach this projection.
     */
    readonly attemptNonce: string;
    readonly state: string;
  }[];
  readonly unprojectedMatches: readonly string[];
  readonly liveRecoveryBatches: readonly string[];
  readonly unacceptedWorkflowStarts: readonly {
    readonly requestedWorkflowId: string;
    readonly workflowType: string;
    readonly requestedAt: string;
    readonly requestSource: string;
  }[];
  /**
   * Paging state, a sibling of the queues rather than a wrapper around them.
   * `cursor` is null exactly when `hasMore` is false.
   */
  readonly pages: Readonly<
    Record<
      OperationsQueueSource,
      { readonly hasMore: boolean; readonly cursor: string | null }
    >
  >;
};

/** The API's own name for each queue, which is what a cursor is keyed by. */
export type OperationsQueueSource =
  | "stalledMatchProcessing"
  | "stalledNotifications"
  | "unknownDeliveries"
  | "unprojectedMatches"
  | "liveRecoveryBatches"
  | "unacceptedWorkflowStarts";

export type OperationsQueueId =
  | "stalled-matches"
  | "stalled-notifications"
  | "unknown-deliveries"
  | "unprojected-matches"
  | "recovery-batches"
  | "unaccepted-starts";

export type OperationsRowFact = {
  readonly label: string;
  readonly value: string;
};

export type OperationsQueueRow = {
  readonly id: string;
  readonly primary: string;
  readonly facts: readonly OperationsRowFact[];
  /** Why this row offers nothing, and how loudly to say it. */
  readonly blocked: NotificationBlocked | null;
  /** The match to open in the pipeline inspector, when the row names one. */
  readonly inspectMatchId: string | null;
  /** Operations this row can prepare directly, already filled in. */
  readonly drafts: readonly OperationsRequestDraft[];
};

export type OperationsQueue = {
  readonly id: OperationsQueueId;
  /** The API key this queue pages against. */
  readonly source: OperationsQueueSource;
  /** Whether the read has rows beyond the ones here, and where to resume. */
  readonly hasMore: boolean;
  readonly cursor: string | null;
  readonly title: string;
  readonly description: string;
  /** Whether this queue holds stuck work rather than work still in flight. */
  readonly stalled: boolean;
  readonly rows: readonly OperationsQueueRow[];
  /**
   * How many rows this console has pulled for the queue, before any filter.
   * Distinct from `rows.length`, which is how many currently MATCH — a search
   * that hides every loaded row still has to say how much it actually looked
   * at, or "no matches" would imply the queue was searched to the end.
   */
  readonly loadedCount: number;
};

/**
 * One evaluation-time clock for the whole projection, so a page cannot straddle
 * a freshness boundary and answer two equally-fresh intents differently.
 */
function projectQueues(
  data: OperationsQueuesData,
  now: number,
): readonly Omit<OperationsQueue, "loadedCount">[] {
  return [
    {
      id: "stalled-matches",
      source: "stalledMatchProcessing",
      ...data.pages.stalledMatchProcessing,
      title: "Stalled match processing",
      description:
        "Observed by the V2 pipeline and left without the receipt that would move it on. Reconciliation is what re-drives these; open one to see its owner, policy and receipts.",
      stalled: true,
      rows: data.stalledMatchProcessing.map((matchId) => ({
        id: matchId,
        primary: matchId,
        facts: [],
        blocked: null,
        inspectMatchId: matchId,
        drafts: [],
      })),
    },
    {
      id: "stalled-notifications",
      source: "stalledNotifications",
      ...data.pages.stalledNotifications,
      title: "Stalled notifications",
      description:
        "Notification intents a Workflow should have sent by now. What each row offers follows its own state and freshness deadline, so an action is shown only where it can succeed.",
      stalled: true,
      rows: data.stalledNotifications.map((record) => {
        const { blocked, drafts } = notificationActions({
          intentKey: record.intentKey,
          state: record.state,
          freshnessDeadline: record.freshnessDeadline,
          now,
        });
        return {
          id: record.intentKey,
          primary: record.intentKey,
          facts: [
            { label: "Match", value: record.matchId },
            { label: "State", value: record.state },
            { label: "Attempts", value: record.attemptCount.toString() },
            { label: "Fresh until", value: record.freshnessDeadline },
          ],
          blocked,
          inspectMatchId: record.matchId,
          drafts,
        };
      }),
    },
    {
      id: "unknown-deliveries",
      source: "unknownDeliveries",
      ...data.pages.unknownDeliveries,
      title: "Unknown deliveries",
      description:
        "Sends whose outcome was never observed. Only an operator can move these, and only by naming the attempt they investigated.",
      stalled: true,
      rows: data.unknownDeliveries.map((record) => ({
        id: record.intentKey,
        primary: record.intentKey,
        facts: [
          { label: "Match", value: record.matchId },
          { label: "Attempts", value: record.attemptCount.toString() },
          { label: "State", value: record.state },
          { label: "Attempt", value: record.attemptNonce },
        ],
        blocked: null,
        // Still offered: the answer is one fact of the intent, and the rest of
        // the match's picture is often what the investigation needs.
        inspectMatchId: record.matchId,
        drafts: [
          resolveDeliveryDraft({
            intentKey: record.intentKey,
            attemptNonce: record.attemptNonce,
          }),
        ],
      })),
    },
    {
      id: "unprojected-matches",
      source: "unprojectedMatches",
      ...data.pages.unprojectedMatches,
      title: "Unprojected matches",
      description:
        "Archived raw, never staged into the report lake. Repairing one asks for a fresh lake projection run.",
      stalled: true,
      rows: data.unprojectedMatches.map((matchId) => ({
        id: matchId,
        primary: matchId,
        facts: [],
        blocked: null,
        inspectMatchId: matchId,
        drafts: [{ kind: "ops_repair_projection", riotMatchId: matchId }],
      })),
    },
    {
      id: "recovery-batches",
      source: "liveRecoveryBatches",
      ...data.pages.liveRecoveryBatches,
      title: "Live recovery batches",
      description:
        "Recovery batches still running. Their blast radius can be widened to stale-private-only, which is the only widening the machine permits.",
      stalled: false,
      rows: data.liveRecoveryBatches.map((recoveryBatchId) => ({
        id: recoveryBatchId,
        primary: recoveryBatchId,
        facts: [],
        blocked: null,
        inspectMatchId: null,
        drafts: [{ kind: "ops_release_recovery_policy", recoveryBatchId }],
      })),
    },
    {
      id: "unaccepted-starts",
      source: "unacceptedWorkflowStarts",
      ...data.pages.unacceptedWorkflowStarts,
      title: "Unaccepted Workflow starts",
      description:
        "Starts that were durably requested and never accepted by Temporal. Reconciliation re-drives the notification and lake-projection families; a reconciliation start is only recovered by requesting one again.",
      stalled: true,
      rows: data.unacceptedWorkflowStarts.map((start) => ({
        id: start.requestedWorkflowId,
        primary: start.requestedWorkflowId,
        facts: [
          { label: "Type", value: start.workflowType },
          { label: "Requested", value: start.requestedAt },
          { label: "Source", value: start.requestSource },
        ],
        blocked: null,
        inspectMatchId: null,
        drafts: [],
      })),
    },
  ];
}

export function operationsQueues(
  data: OperationsQueuesData,
  now: number,
): readonly OperationsQueue[] {
  return projectQueues(data, now).map((queue) => ({
    ...queue,
    loadedCount: queue.rows.length,
  }));
}

export type OperationsFilter = {
  readonly queue: OperationsQueueId | "all";
  readonly search: string;
  readonly stalledOnly: boolean;
};

export const EMPTY_OPERATIONS_FILTER: OperationsFilter = {
  queue: "all",
  search: "",
  stalledOnly: false,
};

function rowMatches(row: OperationsQueueRow, needle: string): boolean {
  return (
    row.primary.toLowerCase().includes(needle) ||
    row.facts.some((fact) => fact.value.toLowerCase().includes(needle))
  );
}

/**
 * Apply an operator's filter.
 *
 * A queue left empty by a SEARCH is dropped, because six empty tables tell the
 * reader nothing about the thing they searched for — UNLESS it has more pages.
 * The console has only searched the rows it pulled, so dropping a queue with
 * a backlog behind it would take away the one control that could reach the row
 * being searched for, and would present a partial search as a finished one. A
 * queue with nothing further to load is genuinely exhausted, and collapses.
 */
export function filterOperationsQueues(
  queues: readonly OperationsQueue[],
  filter: OperationsFilter,
): readonly OperationsQueue[] {
  const needle = filter.search.trim().toLowerCase();
  const selected = queues.filter(
    (queue) =>
      (filter.queue === "all" || queue.id === filter.queue) &&
      (!filter.stalledOnly || queue.stalled),
  );
  if (needle === "") return selected;
  return selected
    .map((queue) => ({
      ...queue,
      rows: queue.rows.filter((row) => rowMatches(row, needle)),
    }))
    .filter((queue) => queue.rows.length > 0 || queue.hasMore);
}

/** How many rows the filtered view is showing, across every queue. */
export function operationsRowCount(queues: readonly OperationsQueue[]): number {
  return queues.reduce((total, queue) => total + queue.rows.length, 0);
}

/**
 * Append one queue's next page to an existing read.
 *
 * Only the named queue moves: its rows are concatenated and its paging state
 * replaced by the newer one. The other five keep the page they already had,
 * because a request that carries one cursor still re-reads every other queue's
 * first page, and folding those back in would silently rewind a queue the
 * operator had already paged through.
 */
export function appendOperationsPage(
  current: OperationsQueuesData,
  source: OperationsQueueSource,
  next: OperationsQueuesData,
): OperationsQueuesData {
  const pages = { ...current.pages, [source]: next.pages[source] };
  switch (source) {
    case "stalledMatchProcessing":
      return {
        ...current,
        pages,
        stalledMatchProcessing: [
          ...current.stalledMatchProcessing,
          ...next.stalledMatchProcessing,
        ],
      };
    case "stalledNotifications":
      return {
        ...current,
        pages,
        stalledNotifications: [
          ...current.stalledNotifications,
          ...next.stalledNotifications,
        ],
      };
    case "unknownDeliveries":
      return {
        ...current,
        pages,
        unknownDeliveries: [
          ...current.unknownDeliveries,
          ...next.unknownDeliveries,
        ],
      };
    case "unprojectedMatches":
      return {
        ...current,
        pages,
        unprojectedMatches: [
          ...current.unprojectedMatches,
          ...next.unprojectedMatches,
        ],
      };
    case "liveRecoveryBatches":
      return {
        ...current,
        pages,
        liveRecoveryBatches: [
          ...current.liveRecoveryBatches,
          ...next.liveRecoveryBatches,
        ],
      };
    case "unacceptedWorkflowStarts":
      return {
        ...current,
        pages,
        unacceptedWorkflowStarts: [
          ...current.unacceptedWorkflowStarts,
          ...next.unacceptedWorkflowStarts,
        ],
      };
  }
}
