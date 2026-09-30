import { describe, expect, test } from "vitest";
import type { NotificationStateKind } from "#src/lib/operations/operations-notification-actions.ts";
import {
  matchIntentRows,
  matchPipelineFacts,
  receiptScopeLabel,
  type MatchPipelineData,
} from "#src/lib/operations/operations-pipeline.ts";

const MATCH_ID = "NA1_1234567890";

/** The moment the fixture picture was read. */
const NOW = Date.parse("2026-09-14T12:00:00.000Z");
const FUTURE = "2026-09-14T12:30:00.000Z";
const PAST = "2026-09-14T11:30:00.000Z";

function pipeline(
  states: readonly {
    key: string;
    kind: NotificationStateKind;
    attemptNonce?: string;
    freshnessDeadline?: string;
  }[],
): MatchPipelineData {
  return {
    processing: {
      matchId: MATCH_ID,
      owner: { kind: "temporal-v2" },
      policy: "FULL",
      promotion: { promotedAt: "2026-09-13T09:00:00.000Z" },
      receipts: [
        {
          kind: "match-observation",
          version: 1,
          scope: { kind: "global" },
          recordedAt: "2026-09-13T09:00:01.000Z",
        },
        {
          kind: "report-delivered",
          version: 2,
          scope: { kind: "guild", guildId: "1337623164146155593" },
          recordedAt: "2026-09-13T09:05:00.000Z",
        },
      ],
    },
    intents: states.map((state) => ({
      intent: {
        key: state.key,
        target: { kind: "channel" },
        freshnessDeadline: state.freshnessDeadline ?? FUTURE,
        attemptCount: 1,
        state:
          state.attemptNonce === undefined
            ? { kind: state.kind }
            : { kind: state.kind, attemptNonce: state.attemptNonce },
      },
    })),
    trackedAccounts: [
      {
        puuid: "puuid-1",
        playerId: 4,
        accountId: null,
        cursorAdvancedAt: null,
      },
    ],
  };
}

describe("the match summary", () => {
  test("leads with the facts an operator triages on", () => {
    expect(matchPipelineFacts(pipeline([]))).toEqual([
      { label: "Owner", value: "Temporal v2" },
      { label: "Policy", value: "FULL" },
      { label: "Promoted", value: "2026-09-13T09:00:00.000Z" },
      { label: "Receipts", value: "2" },
      { label: "Intents", value: "0" },
      { label: "Tracked accounts", value: "1" },
    ]);
  });

  test("an unpromoted match says never rather than showing a blank", () => {
    const data = pipeline([]);
    const unpromoted: MatchPipelineData = {
      ...data,
      processing: {
        ...data.processing,
        promotion: null,
        policy: "ARCHIVE_ONLY",
      },
    };
    expect(matchPipelineFacts(unpromoted)).toContainEqual({
      label: "Promoted",
      value: "never",
    });
  });

  test("receipt scopes read as themselves", () => {
    expect(receiptScopeLabel({ kind: "global" })).toBe("global");
    expect(receiptScopeLabel({ kind: "guild", guildId: "42" })).toBe(
      "guild 42",
    );
    expect(receiptScopeLabel({ kind: "account", accountId: 7 })).toBe(
      "account 7",
    );
  });
});

describe("what each intent offers", () => {
  test("a fresh drivable intent offers a re-drive, never a suppression", () => {
    // Suppressing an intent whose deadline has not passed answers not-stale,
    // so the inspector must not offer it either — same rule as the queue.
    const rows = matchIntentRows(
      pipeline([
        { key: "intent-pending", kind: "pending" },
        { key: "intent-ready", kind: "ready" },
      ]),
      NOW,
    );
    for (const row of rows) {
      expect(row.blocked).toBeNull();
      expect(row.drafts.map((draft) => draft.kind)).toEqual([
        "ops_retry_notification",
      ]);
    }
  });

  test("a stale intent is where suppression actually appears", () => {
    // Unlike the stalled-notification queue, this surface can show an intent
    // whose deadline has passed — which is the only place suppression works.
    const row = matchIntentRows(
      pipeline([
        { key: "intent-stale", kind: "ready", freshnessDeadline: PAST },
      ]),
      NOW,
    )[0];
    expect(row?.drafts.map((draft) => draft.kind)).toEqual([
      "ops_suppress_stale_notification",
    ]);
  });

  test("an unknown delivery offers only the answer, carrying its attempt", () => {
    const row = matchIntentRows(
      pipeline([
        {
          key: "intent-unknown",
          kind: "unknown-delivery",
          attemptNonce: "attempt-3",
        },
      ]),
      NOW,
    )[0];
    expect(row?.blocked).toBeNull();
    expect(row?.drafts).toEqual([
      {
        kind: "ops_resolve_unknown_delivery",
        intentKey: "intent-unknown",
        attemptNonce: "attempt-3",
        outcome: "not-delivered",
        messageId: "",
        deliveredAt: "",
      },
    ]);
    // The nonce is shown, so the operator can see the attempt they are about
    // to answer rather than trust that the console picked the right one.
    expect(row?.facts).toContainEqual({
      label: "Attempt",
      value: "attempt-3",
    });
  });

  test("an unknown delivery with no attempt is refused, not guessed at", () => {
    const row = matchIntentRows(
      pipeline([{ key: "intent-broken", kind: "unknown-delivery" }]),
      NOW,
    )[0];
    expect(row?.drafts).toEqual([]);
    // The domain guarantees a nonce on this state, so its absence is a break.
    expect(row?.blocked?.tone).toBe("contract-violation");
    expect(row?.blocked?.message).toContain("contract violation");
    expect(row?.blocked?.message).toContain("cannot name");
  });

  test("a sending intent offers nothing, and says why", () => {
    const row = matchIntentRows(
      pipeline([
        { key: "intent-sending", kind: "sending", attemptNonce: "attempt-1" },
      ]),
      NOW,
    )[0];
    expect(row?.drafts).toEqual([]);
    expect(row?.blocked?.tone).toBe("rule");
    expect(row?.blocked?.message).toContain("cannot be re-driven");
  });

  test("a settled intent is finished", () => {
    for (const kind of [
      "delivered",
      "suppressed",
      "expired",
      "permission-denied",
    ] as const) {
      const row = matchIntentRows(
        pipeline([{ key: `i-${kind}`, kind }]),
        NOW,
      )[0];
      expect(row?.drafts).toEqual([]);
      expect(row?.blocked).toEqual({
        tone: "rule",
        message: "This intent has settled.",
      });
    }
  });
});
