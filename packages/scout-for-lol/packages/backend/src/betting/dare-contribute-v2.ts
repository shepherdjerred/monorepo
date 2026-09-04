import {
  BUCKS_INT32_MAX,
  BucksDareV2StateSchema,
  OPEN_BUCKS_DARE_V2_STATES,
  type BucksDareV2State,
  type DiscordAccountId,
} from "@scout-for-lol/data";
import { pendingDareV2CalloutRefresh } from "#src/betting/dare-callout-refresh-state-v2.ts";
import { stakeDareV2ContributionInTransaction } from "#src/betting/dare-ledger-v2.ts";
import type { Db } from "#src/database/index.ts";
import { enqueueDareNotificationInTransaction } from "#src/betting/dare-notification-outbox.ts";

const OPEN_DARE_STATES: ReadonlySet<BucksDareV2State> = new Set(
  OPEN_BUCKS_DARE_V2_STATES,
);

export async function contributeToDareV2InTransaction(
  tx: Db,
  input: {
    dareId: number;
    revision: number;
    actorDiscordId: DiscordAccountId;
    bucksAccountId: number;
    amount: number;
    now: Date;
  },
) {
  const claimed = await tx.bucksDareV2.updateManyAndReturn({
    where: {
      id: input.dareId,
      fundedRevision: input.revision,
      OR: [
        { dareState: "pending_accept" },
        { dareState: "activating" },
        { dareState: "active", deadlineAt: { gt: input.now } },
      ],
      potTotal: { lte: BUCKS_INT32_MAX - input.amount },
      targets: { none: { discordId: input.actorDiscordId } },
    },
    data: {
      potTotal: { increment: input.amount },
      updatedAt: input.now,
      ...pendingDareV2CalloutRefresh(),
    },
    select: {
      id: true,
      serverId: true,
      potTotal: true,
      dareState: true,
      fundedRevision: true,
    },
  });
  const dare = claimed[0];
  if (dare === undefined || claimed.length !== 1) {
    const current = await tx.bucksDareV2.findUniqueOrThrow({
      where: { id: input.dareId },
      include: { targets: { select: { discordId: true } } },
    });
    if (
      current.targets.some(
        (target) => target.discordId === input.actorDiscordId,
      )
    ) {
      return { kind: "target_cannot_contribute" } as const;
    }
    const state = BucksDareV2StateSchema.parse(current.dareState);
    const beforeDeadline =
      state !== "active" ||
      (current.deadlineAt !== null && current.deadlineAt > input.now);
    if (
      beforeDeadline &&
      OPEN_DARE_STATES.has(state) &&
      current.potTotal + input.amount > BUCKS_INT32_MAX
    ) {
      return { kind: "pot_full", potTotal: current.potTotal } as const;
    }
    return { kind: "too_late", dareState: state } as const;
  }
  const [targets, revision] = await Promise.all([
    tx.bucksDareV2Target.findMany({
      where: { dareId: dare.id },
      orderBy: { id: "asc" },
      select: { alias: true },
    }),
    tx.bucksDareV2Revision.findUniqueOrThrow({
      where: {
        dareId_revision: { dareId: dare.id, revision: input.revision },
      },
      select: { plainLanguage: true, compilerVersion: true },
    }),
  ]);
  const balance = await stakeDareV2ContributionInTransaction(tx, {
    facts: {
      contractVersion: revision.compilerVersion === "dare-scoutql-3" ? 3 : 2,
      dareId: dare.id,
      serverId: dare.serverId,
      potTotal: dare.potTotal,
      targetAliases: targets.map((target) => target.alias),
      conditionSummary: revision.plainLanguage,
    },
    bucksAccountId: input.bucksAccountId,
    discordId: input.actorDiscordId,
    amount: input.amount,
  });
  await enqueueDareNotificationInTransaction(tx, {
    dareId: dare.id,
    revision: input.revision,
    category: "lifecycle",
    kind: "contributed",
    actorDiscordId: input.actorDiscordId,
    summary: `A ${input.amount.toString()} Bryan Bucks contribution raised the pot to ${dare.potTotal.toString()}.`,
    deduplicationKey: `dare:${dare.id.toString()}:revision:${input.revision.toString()}:contribution:${input.actorDiscordId}:${input.now.toISOString()}`,
    occurredAt: input.now,
  });
  return {
    kind: "contributed",
    amount: input.amount,
    potTotal: dare.potTotal,
    balanceAfter: balance,
  } as const;
}
