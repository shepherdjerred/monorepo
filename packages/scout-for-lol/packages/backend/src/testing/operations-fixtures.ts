import {
  IsoInstantSchema,
  NotificationIntentKeySchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import type { DiscordChannelId } from "@scout-for-lol/data";
import type { MatchNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import { SCOUT_OPERATOR_IDS } from "#src/operations/operator-allowlist.ts";
import {
  addFlagOverride,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";
import type { createOfflineTrpcHarness } from "#src/testing/test-trpc-caller.ts";

/** An ISO instant `offsetMs` from now. */
export function instant(offsetMs: number) {
  return IsoInstantSchema.parse(new Date(Date.now() + offsetMs).toISOString());
}

/**
 * The first allowlisted operator. An empty allowlist would make every
 * assertion in the operations tests vacuous rather than failing, so it is
 * refused here instead.
 */
export function firstOperator() {
  const [first] = SCOUT_OPERATOR_IDS;
  if (first === undefined) {
    throw new Error(
      "The operator allowlist is empty; these tests prove nothing",
    );
  }
  return first;
}

/** A notification intent record for one match and channel. */
export function operationsIntentRecord(args: {
  matchId: RiotMatchId;
  channelId: DiscordChannelId;
  key: string;
  deadlineOffsetMs: number;
  state: MatchNotificationIntentRecord["intent"]["state"];
  attemptCount: number;
  kind?: MatchNotificationIntentRecord["intent"]["kind"];
}): MatchNotificationIntentRecord {
  return {
    matchId: args.matchId,
    intent: {
      key: NotificationIntentKeySchema.parse(args.key),
      kind: args.kind ?? "postmatch",
      origin: { kind: "live" },
      target: { kind: "channel", channelId: args.channelId },
      freshnessDeadline: instant(args.deadlineOffsetMs),
      createdAt: instant(-60_000),
      attemptCount: args.attemptCount,
      state: args.state,
    },
  };
}

type OperationsTestDb = Awaited<
  ReturnType<typeof createOfflineTrpcHarness>
>["prisma"];

/**
 * Empty the tables an operations test writes and show the console to everyone.
 * The flag is on globally, so every denial a test sees is the credential's or
 * the allowlist's doing, never the flag's.
 */
export async function resetOperationsSuiteState(
  db: OperationsTestDb,
): Promise<void> {
  await db.confirmationIntent.deleteMany();
  await db.auditLog.deleteMany();
  await db.matchNotificationIntent.deleteMany();
  await db.matchObservation.deleteMany();
  resetFlagOverrides("scout_operations_console_enabled");
  addFlagOverride("scout_operations_console_enabled", true, {});
}
