import {
  BUCKS_INT32_MAX,
  BucksDareStateSchema,
  DarePotTotalSchema,
  OPEN_BUCKS_DARE_STATES,
  type BucksDareState,
  type DarePileOn,
  type DiscordAccountId,
} from "@scout-for-lol/data";
import { pendingDareCalloutRefresh } from "#src/betting/dares/presentation/dare-callout-refresh-state.ts";
import { stakeDareContributionInTransaction } from "#src/betting/dares/settlement/dare-ledger.ts";
import type { Db } from "#src/database/index.ts";
import { enqueueDareNotificationInTransaction } from "#src/betting/dares/presentation/notify/dare-notification-outbox.ts";

const OPEN_DARE_STATES: ReadonlySet<BucksDareState> = new Set(
  OPEN_BUCKS_DARE_STATES,
);

export async function contributeToDareInTransaction(
  tx: Db,
  input: {
    dareId: number;
    revision: number;
    actorDiscordId: DiscordAccountId;
    bucksAccountId: number;
    amount: DarePileOn;
    now: Date;
  },
) {
  const claimed = await tx.bucksDare.updateManyAndReturn({
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
      ...pendingDareCalloutRefresh(),
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
    const current = await tx.bucksDare.findUniqueOrThrow({
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
    const state = BucksDareStateSchema.parse(current.dareState);
    const beforeDeadline =
      state !== "active" ||
      (current.deadlineAt !== null && current.deadlineAt > input.now);
    return beforeDeadline &&
      OPEN_DARE_STATES.has(state) &&
      current.potTotal + input.amount > BUCKS_INT32_MAX
      ? ({
          kind: "pot_full",
          potTotal: DarePotTotalSchema.parse(current.potTotal),
        } as const)
      : ({ kind: "too_late", dareState: state } as const);
  }
  const potTotal = DarePotTotalSchema.parse(dare.potTotal);
  const [targets, revision] = await Promise.all([
    tx.bucksDareTarget.findMany({
      where: { dareId: dare.id },
      orderBy: { id: "asc" },
      select: { alias: true },
    }),
    tx.bucksDareRevision.findUniqueOrThrow({
      where: {
        dareId_revision: { dareId: dare.id, revision: input.revision },
      },
      select: { plainLanguage: true },
    }),
  ]);
  const balance = await stakeDareContributionInTransaction(tx, {
    facts: {
      dareId: dare.id,
      serverId: dare.serverId,
      potTotal,
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
    summary: `A ${input.amount.toString()} Bryan Bucks contribution raised the pot to ${potTotal.toString()}.`,
    deduplicationKey: `dare:${dare.id.toString()}:revision:${input.revision.toString()}:contribution:${input.actorDiscordId}:${input.now.toISOString()}`,
    occurredAt: input.now,
  });
  return {
    kind: "contributed",
    amount: input.amount,
    potTotal,
    balanceAfter: balance,
  } as const;
}
