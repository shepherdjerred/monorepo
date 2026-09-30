import { describe, expect, test } from "vitest";
import {
  NotificationIntentKeySchema,
  RiotMatchIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import { DiscordChannelIdSchema } from "@scout-for-lol/domain/identity/discord.ts";
import {
  NotificationIntentSchema,
  NotificationIntentStateSchema,
  type NotificationIntentState,
} from "@scout-for-lol/domain/notifications/intent.ts";
import type { MatchNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import { drivablePrematchIntentKeys } from "#src/temporal/v2/prematch/prematch-reads.ts";

const MATCH_ID = RiotMatchIdSchema.parse("NA1_9101");
const CHANNEL = "100000000000000001";

function state(candidate: unknown): NotificationIntentState {
  return NotificationIntentStateSchema.parse(candidate);
}

function intentRecord(
  key: string,
  intentState: NotificationIntentState,
): MatchNotificationIntentRecord {
  return {
    matchId: MATCH_ID,
    intent: NotificationIntentSchema.parse({
      key: NotificationIntentKeySchema.parse(key),
      kind: "prematch",
      origin: { kind: "live" },
      target: {
        kind: "channel",
        channelId: DiscordChannelIdSchema.parse(CHANNEL),
      },
      freshnessDeadline: "2026-09-13T03:00:00.000Z",
      createdAt: "2026-09-13T00:00:00.000Z",
      // `sending` and `unknown-delivery` are only reachable after a beginSend,
      // which the intent schema enforces.
      attemptCount:
        intentState.kind === "sending" ||
        intentState.kind === "unknown-delivery"
          ? 1
          : 0,
      state: intentState,
    }),
  };
}

describe("drivablePrematchIntentKeys", () => {
  test("takes the prematch intents a notification child can still drive", () => {
    const keys = drivablePrematchIntentKeys(MATCH_ID, [
      intentRecord(
        `prematch-discord:${MATCH_ID}:1`,
        state({ kind: "pending" }),
      ),
      intentRecord(`prematch-discord:${MATCH_ID}:2`, state({ kind: "ready" })),
      intentRecord(
        `prematch-discord:${MATCH_ID}:3`,
        state({
          kind: "sending",
          attemptNonce: "nonce-three",
          startedAt: "2026-09-13T00:00:01.000Z",
        }),
      ),
    ]);

    expect(keys).toEqual([
      `prematch-discord:${MATCH_ID}:1`,
      `prematch-discord:${MATCH_ID}:2`,
      `prematch-discord:${MATCH_ID}:3`,
    ]);
  });

  test("leaves the post-match intents for the post-match fan-out", () => {
    // Both paths key their intents by the SAME match id, which is what lets a
    // prematch snapshot and the completed match share one receipt scope. A
    // prematch run reprocessed after the game finished would otherwise start
    // the post-match announcement too, and two Workflows would drive one
    // intent.
    const keys = drivablePrematchIntentKeys(MATCH_ID, [
      intentRecord(
        `postmatch-discord:${MATCH_ID}:1`,
        state({ kind: "pending" }),
      ),
      intentRecord(
        `prematch-discord:${MATCH_ID}:1`,
        state({ kind: "pending" }),
      ),
    ]);

    expect(keys).toEqual([`prematch-discord:${MATCH_ID}:1`]);
  });

  test.each([
    { name: "delivered", deliveredAt: "2026-09-13T00:00:02.000Z" },
    { name: "suppressed", reason: "stale" },
    { name: "expired" },
    { name: "permission-denied" },
    {
      name: "unknown-delivery",
      attemptNonce: "nonce-unknown",
      observedAt: "2026-09-13T00:00:03.000Z",
    },
  ])("does not re-drive a $name intent", ({ name, ...payload }) => {
    // `unknown-delivery` is the one that matters most: the request left, the
    // response did not arrive, and only an operator can decide whether a
    // message exists. Starting a child on it is how a user gets told twice.
    expect(
      drivablePrematchIntentKeys(MATCH_ID, [
        intentRecord(
          `prematch-discord:${MATCH_ID}:1`,
          state({ kind: name, ...payload }),
        ),
      ]),
    ).toEqual([]);
  });
});
