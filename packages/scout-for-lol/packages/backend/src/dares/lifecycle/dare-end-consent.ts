import { currentDareState } from "#src/dares/dare-common.ts";
import { pendingDareCalloutRefresh } from "#src/dares/presentation/dare-callout-refresh-state.ts";
import { mintDareStatusIntents } from "#src/dares/presentation/notify/dare-status-intent.ts";
import type { Db } from "#src/database/index.ts";
import type { DiscordAccountId } from "@scout-for-lol/data";

export async function declineDareInTransaction(
  tx: Db,
  input: {
    dareId: number;
    revision: number;
    actorDiscordId: DiscordAccountId;
    now: Date;
  },
) {
  const claim = await tx.dare.updateMany({
    where: {
      id: input.dareId,
      dareState: "pending_accept",
      publishedRevision: input.revision,
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
  const stamp = await tx.dareTarget.updateMany({
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
  await mintDareStatusIntents(tx, {
    dareId: input.dareId,
    revision: input.revision,
    category: "lifecycle",
    kind: "declined",
    actorDiscordId: input.actorDiscordId,
    summary: "A target declined the Dare.",
    deduplicationKey: `dare:${input.dareId.toString()}:revision:${input.revision.toString()}:declined`,
    occurredAt: input.now,
  });
  return { kind: "declined" } as const;
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
  const claim = await tx.dare.updateMany({
    where: {
      id: input.dareId,
      challengerDiscordId: input.actorDiscordId,
      dareState: "pending_accept",
      publishedRevision: input.revision,
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
  await mintDareStatusIntents(tx, {
    dareId: input.dareId,
    revision: input.revision,
    category: "lifecycle",
    kind: "cancelled",
    actorDiscordId: input.actorDiscordId,
    summary: "The Dare was cancelled before activation.",
    deduplicationKey: `dare:${input.dareId.toString()}:revision:${input.revision.toString()}:cancelled`,
    occurredAt: input.now,
  });
  return { kind: "cancelled" } as const;
}
