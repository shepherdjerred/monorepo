import type { DiscordAccountId } from "@scout-for-lol/data";
import { pendingDareCalloutRefresh } from "#src/betting/dares/presentation/dare-callout-refresh-state.ts";
import {
  dareMoneyFactsInTransaction,
  refundDareContributionsInTransaction,
} from "#src/betting/dares/settlement/dare-ledger.ts";
import { currentDareState } from "#src/betting/dares/dare-common.ts";
import type { Db } from "#src/database/index.ts";
import { enqueueDareNotificationInTransaction } from "#src/betting/dares/presentation/notify/dare-notification-outbox.ts";

async function freshFacts(tx: Db, dareId: number) {
  const dare = await tx.bucksDare.findUniqueOrThrow({
    where: { id: dareId },
    include: { targets: { orderBy: { id: "asc" } } },
  });
  const revision = await tx.bucksDareRevision.findUniqueOrThrow({
    where: {
      dareId_revision: {
        dareId,
        revision: dare.fundedRevision ?? dare.currentRevision,
      },
    },
  });
  return await dareMoneyFactsInTransaction(tx, {
    dareId,
    serverId: dare.serverId,
    targetAliases: dare.targets.map((target) => target.alias),
    conditionSummary: revision.plainLanguage,
  });
}

export async function declineDareInTransaction(
  tx: Db,
  input: {
    dareId: number;
    revision: number;
    actorDiscordId: DiscordAccountId;
    now: Date;
  },
) {
  const claim = await tx.bucksDare.updateMany({
    where: {
      id: input.dareId,
      dareState: "pending_accept",
      fundedRevision: input.revision,
      targets: {
        some: {
          discordId: input.actorDiscordId,
          acceptedAt: null,
          declinedAt: null,
        },
      },
    },
    data: {
      dareState: "declined",
      settledAt: input.now,
      ...pendingDareCalloutRefresh(),
    },
  });
  if (claim.count !== 1) {
    return {
      kind: "not_declineable",
      dareState: await currentDareState(tx, input.dareId),
    } as const;
  }
  const stamp = await tx.bucksDareTarget.updateMany({
    where: {
      dareId: input.dareId,
      discordId: input.actorDiscordId,
      acceptedAt: null,
      declinedAt: null,
    },
    data: { declinedAt: input.now },
  });
  if (stamp.count !== 1) {
    throw new Error(
      `Dare ${input.dareId.toString()} decline lost its target claim.`,
    );
  }
  const facts = await freshFacts(tx, input.dareId);
  const refunds = await refundDareContributionsInTransaction(tx, {
    facts,
    resolution: "declined",
    withCut: false,
  });
  await enqueueDareNotificationInTransaction(tx, {
    dareId: input.dareId,
    revision: input.revision,
    category: "lifecycle",
    kind: "declined",
    actorDiscordId: input.actorDiscordId,
    summary: `A target declined; the ${facts.potTotal.toString()} Bryan Bucks pot was fully refunded.`,
    deduplicationKey: `dare:${input.dareId.toString()}:revision:${input.revision.toString()}:declined`,
    occurredAt: input.now,
  });
  return { kind: "declined", potTotal: facts.potTotal, refunds } as const;
}

export async function cancelDareInTransaction(
  tx: Db,
  input: {
    dareId: number;
    revision: number;
    actorDiscordId: DiscordAccountId;
    now: Date;
  },
) {
  const claim = await tx.bucksDare.updateMany({
    where: {
      id: input.dareId,
      challengerDiscordId: input.actorDiscordId,
      dareState: "pending_accept",
      fundedRevision: input.revision,
    },
    data: {
      dareState: "cancelled",
      settledAt: input.now,
      ...pendingDareCalloutRefresh(),
    },
  });
  if (claim.count !== 1) {
    return {
      kind: "not_cancellable",
      dareState: await currentDareState(tx, input.dareId),
    } as const;
  }
  const facts = await freshFacts(tx, input.dareId);
  const refunds = await refundDareContributionsInTransaction(tx, {
    facts,
    resolution: "cancelled",
    withCut: false,
  });
  await enqueueDareNotificationInTransaction(tx, {
    dareId: input.dareId,
    revision: input.revision,
    category: "lifecycle",
    kind: "cancelled",
    actorDiscordId: input.actorDiscordId,
    summary: `The Dare was cancelled before activation; ${facts.potTotal.toString()} Bryan Bucks were fully refunded.`,
    deduplicationKey: `dare:${input.dareId.toString()}:revision:${input.revision.toString()}:cancelled`,
    occurredAt: input.now,
  });
  return { kind: "cancelled", potTotal: facts.potTotal, refunds } as const;
}
