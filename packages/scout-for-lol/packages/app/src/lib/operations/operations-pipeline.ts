import {
  notificationActions,
  type NotificationBlocked,
  type NotificationStateKind,
} from "#src/lib/operations/operations-notification-actions.ts";
import type { OperationsRequestDraft } from "#src/lib/operations/operations-payloads.ts";
import type { OperationsRowFact } from "#src/lib/operations/operations-queues.ts";

/**
 * One match's durable picture, projected for an operator.
 *
 * The closed vocabularies below are spelled out as literal unions rather than
 * `string` so the projection can be tested without the backend types AND still
 * switch exhaustively. A state the domain adds and this file has not accounted
 * for is then a type error here rather than a row that silently offers nothing.
 *
 * Which actions an intent offers is a domain fact rather than a layout choice,
 * so it is decided by `notificationActions` — the same derivation the queue
 * table uses. This module only supplies the row's own state and deadline.
 */

export type PipelineOwnerKind = "unowned" | "legacy-v1" | "temporal-v2";

export type MatchPipelineData = {
  readonly processing: {
    readonly matchId: string;
    readonly owner: { readonly kind: PipelineOwnerKind };
    readonly policy: "ARCHIVE_ONLY" | "FULL";
    readonly promotion: { readonly promotedAt: string } | null;
    readonly receipts: readonly {
      readonly kind: string;
      readonly version: number;
      readonly scope:
        | { readonly kind: "global" }
        | { readonly kind: "guild"; readonly guildId: string }
        | { readonly kind: "account"; readonly accountId: number };
      readonly recordedAt: string;
    }[];
  };
  readonly intents: readonly {
    readonly intent: {
      readonly key: string;
      readonly target: { readonly kind: string };
      readonly freshnessDeadline: string;
      readonly attemptCount: number;
      readonly state: {
        readonly kind: NotificationStateKind;
        readonly attemptNonce?: string;
      };
    };
  }[];
  readonly trackedAccounts: readonly {
    readonly puuid: string;
    readonly playerId: number | null;
    readonly accountId: number | null;
    readonly cursorAdvancedAt: string | null;
  }[];
};

const OWNER_LABEL: Record<PipelineOwnerKind, string> = {
  unowned: "Unowned",
  "legacy-v1": "Legacy v1",
  "temporal-v2": "Temporal v2",
};

export function matchPipelineFacts(
  data: MatchPipelineData,
): readonly OperationsRowFact[] {
  const { processing } = data;
  return [
    { label: "Owner", value: OWNER_LABEL[processing.owner.kind] },
    { label: "Policy", value: processing.policy },
    {
      label: "Promoted",
      value: processing.promotion?.promotedAt ?? "never",
    },
    { label: "Receipts", value: processing.receipts.length.toString() },
    { label: "Intents", value: data.intents.length.toString() },
    {
      label: "Tracked accounts",
      value: data.trackedAccounts.length.toString(),
    },
  ];
}

export function receiptScopeLabel(
  scope: MatchPipelineData["processing"]["receipts"][number]["scope"],
): string {
  switch (scope.kind) {
    case "global":
      return "global";
    case "guild":
      return `guild ${scope.guildId}`;
    case "account":
      return `account ${scope.accountId.toString()}`;
  }
}

export type MatchIntentRow = {
  readonly intentKey: string;
  readonly state: NotificationStateKind;
  readonly facts: readonly OperationsRowFact[];
  /**
   * Why this intent offers nothing, when it offers nothing. Rendered instead
   * of an empty cell so the absence reads as a domain rule rather than a gap.
   */
  readonly blocked: NotificationBlocked | null;
  readonly drafts: readonly OperationsRequestDraft[];
};

export function matchIntentRows(
  data: MatchPipelineData,
  /** One evaluation-time clock for the whole render; see `notificationActions`. */
  now: number,
): readonly MatchIntentRow[] {
  return data.intents.map(({ intent }) => {
    const { blocked, drafts } = notificationActions({
      intentKey: intent.key,
      state: intent.state.kind,
      freshnessDeadline: intent.freshnessDeadline,
      now,
      ...(intent.state.attemptNonce === undefined
        ? {}
        : { attemptNonce: intent.state.attemptNonce }),
    });
    return {
      intentKey: intent.key,
      state: intent.state.kind,
      facts: [
        { label: "Target", value: intent.target.kind },
        { label: "Attempts", value: intent.attemptCount.toString() },
        { label: "Fresh until", value: intent.freshnessDeadline },
        ...(intent.state.attemptNonce === undefined
          ? []
          : [{ label: "Attempt", value: intent.state.attemptNonce }]),
      ],
      blocked,
      drafts,
    };
  });
}
