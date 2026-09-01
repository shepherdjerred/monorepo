import type { DiscordAccountId } from "@scout-for-lol/data";
import { pendingDareV2CalloutRefresh } from "#src/betting/dare-callout-refresh-state-v2.ts";
import {
  dareV2MoneyFactsInTransaction,
  refundDareV2ContributionsInTransaction,
} from "#src/betting/dare-ledger-v2.ts";
import { currentDareV2State } from "#src/betting/dare-v2-common.ts";
import type { Db } from "#src/database/index.ts";

async function freshFacts(tx: Db, dareId: number) {
  const dare = await tx.bucksDareV2.findUniqueOrThrow({
    where: { id: dareId },
    include: { targets: { orderBy: { id: "asc" } } },
  });
  const revision = await tx.bucksDareV2Revision.findUniqueOrThrow({
    where: {
      dareId_revision: {
        dareId,
        revision: dare.fundedRevision ?? dare.currentRevision,
      },
    },
  });
  return await dareV2MoneyFactsInTransaction(tx, {
    dareId,
    serverId: dare.serverId,
    potTotal: dare.potTotal,
    targetAliases: dare.targets.map((target) => target.alias),
    conditionSummary: revision.plainLanguage,
  });
}

export async function declineDareV2InTransaction(
  tx: Db,
  input: {
    dareId: number;
    revision: number;
    actorDiscordId: DiscordAccountId;
    now: Date;
  },
) {
  const claim = await tx.bucksDareV2.updateMany({
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
      ...pendingDareV2CalloutRefresh(),
    },
  });
  if (claim.count !== 1) {
    return {
      kind: "not_declineable",
      dareState: await currentDareV2State(tx, input.dareId),
    } as const;
  }
  const stamp = await tx.bucksDareV2Target.updateMany({
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
      `Dare v2 ${input.dareId.toString()} decline lost its target claim.`,
    );
  }
  const facts = await freshFacts(tx, input.dareId);
  const refunds = await refundDareV2ContributionsInTransaction(tx, {
    facts,
    resolution: "declined",
    withCut: false,
  });
  return { kind: "declined", potTotal: facts.potTotal, refunds } as const;
}

export async function cancelDareV2InTransaction(
  tx: Db,
  input: {
    dareId: number;
    revision: number;
    actorDiscordId: DiscordAccountId;
    now: Date;
  },
) {
  const claim = await tx.bucksDareV2.updateMany({
    where: {
      id: input.dareId,
      challengerDiscordId: input.actorDiscordId,
      dareState: "pending_accept",
      fundedRevision: input.revision,
    },
    data: {
      dareState: "cancelled",
      settledAt: input.now,
      ...pendingDareV2CalloutRefresh(),
    },
  });
  if (claim.count !== 1) {
    return {
      kind: "not_cancellable",
      dareState: await currentDareV2State(tx, input.dareId),
    } as const;
  }
  const facts = await freshFacts(tx, input.dareId);
  const refunds = await refundDareV2ContributionsInTransaction(tx, {
    facts,
    resolution: "cancelled",
    withCut: false,
  });
  return { kind: "cancelled", potTotal: facts.potTotal, refunds } as const;
}
