/** Karma persistence, shared by every entry point that can award karma:
 *  the slash command, the message context menu, and reactions. Keeping the
 *  writes in one place means new surfaces cannot drift from the scoring rules
 *  or forget to create the `person` rows the foreign keys need. */
import { prisma } from "#src/db/index.ts";
import {
  crossedUnannouncedMilestone,
  highestReachedMilestone,
} from "#src/karma/milestones.ts";

/** Ensure a `person` row exists so the karma foreign keys resolve. */
async function ensurePerson(id: string): Promise<void> {
  await prisma.person.upsert({ where: { id }, create: { id }, update: {} });
}

export type RecordKarmaParams = {
  giverId: string;
  receiverId: string;
  amount: number;
  guildId: string;
  reason?: string | undefined;
  /** Set for reaction awards; enables revoke-on-unreact and dedup. */
  sourceMessageId?: string | undefined;
};

/**
 * Write one karma event.
 *
 * Reaction awards go through `upsert` on the `(giverId, sourceMessageId)`
 * unique index so that removing and re-adding a reaction cannot stack — the
 * second add is a no-op rather than a duplicate or a thrown constraint error.
 * Non-reaction gives always insert, since repeat gives are legitimate.
 */
export type RecordKarmaResult = {
  receiverTotalBefore: number;
  receiverTotalAfter: number;
  milestone: number | null;
};

export async function recordKarma(
  params: RecordKarmaParams,
): Promise<RecordKarmaResult> {
  await ensurePerson(params.giverId);
  if (params.receiverId !== params.giverId) {
    await ensurePerson(params.receiverId);
  }

  const data = {
    amount: params.amount,
    datetime: new Date(),
    reason: params.reason ?? null,
    guildId: params.guildId,
    giverId: params.giverId,
    receiverId: params.receiverId,
    sourceMessageId: params.sourceMessageId ?? null,
  };

  console.warn(
    `[Karma DB] Saving karma: ${params.giverId} -> ${params.receiverId}, amount: ${params.amount.toString()}, guild: ${params.guildId}${params.sourceMessageId === undefined ? "" : `, message: ${params.sourceMessageId}`}`,
  );

  // One serialized transaction around read-write-read. Run as independent
  // statements, two concurrent awards near a threshold can both read 99 and
  // both then observe 100 — announcing the same milestone twice and reporting
  // a total that includes the other award.
  return prisma.$transaction(async (tx) => {
    const before = await tx.karma.aggregate({
      _sum: { amount: true },
      where: { receiverId: params.receiverId, guildId: params.guildId },
    });

    if (params.sourceMessageId === undefined) {
      await tx.karma.create({ data });
    } else {
      await tx.karma.upsert({
        where: {
          giverId_sourceMessageId: {
            giverId: params.giverId,
            sourceMessageId: params.sourceMessageId,
          },
        },
        create: data,
        update: {},
      });
    }

    const after = await tx.karma.aggregate({
      _sum: { amount: true },
      where: { receiverId: params.receiverId, guildId: params.guildId },
    });

    const receiverTotalBefore = before._sum.amount ?? 0;
    const receiverTotalAfter = after._sum.amount ?? 0;
    const state = await tx.milestoneState.findUnique({
      where: {
        guildId_receiverId: {
          guildId: params.guildId,
          receiverId: params.receiverId,
        },
      },
      select: { highestAnnounced: true },
    });

    // A missing state row can occur for a person who had karma before this
    // table existed. Seed from the balance before this write so deployment
    // never turns an old total into a retroactive milestone announcement.
    const highestAnnounced = Math.max(
      state?.highestAnnounced ?? 0,
      highestReachedMilestone(receiverTotalBefore),
    );
    const milestone = crossedUnannouncedMilestone(
      receiverTotalBefore,
      receiverTotalAfter,
      highestAnnounced,
    );
    const nextHighestAnnounced = milestone ?? highestAnnounced;
    if (nextHighestAnnounced > (state?.highestAnnounced ?? 0)) {
      await tx.milestoneState.upsert({
        where: {
          guildId_receiverId: {
            guildId: params.guildId,
            receiverId: params.receiverId,
          },
        },
        create: {
          guildId: params.guildId,
          receiverId: params.receiverId,
          highestAnnounced: nextHighestAnnounced,
        },
        update: { highestAnnounced: nextHighestAnnounced },
      });
    }

    return {
      receiverTotalBefore,
      receiverTotalAfter,
      milestone,
    };
  });
}

/** Remove the karma a giver awarded via a reaction on a specific message.
 *  Returns how many rows were removed (0 when the reaction never awarded). */
export async function revokeReactionKarma(
  giverId: string,
  sourceMessageId: string,
): Promise<number> {
  const { count } = await prisma.karma.deleteMany({
    where: { giverId, sourceMessageId },
  });
  return count;
}

/** Remove every reaction award linked to a message. Discord emits bulk events
 * when a moderator clears all reactions or removes one emoji entirely, rather
 * than one remove event per giver. */
export async function revokeMessageReactionKarma(
  sourceMessageId: string,
): Promise<number> {
  const { count } = await prisma.karma.deleteMany({
    where: { sourceMessageId },
  });
  return count;
}

export async function getReceivedKarma(
  id: string,
  guildId: string,
): Promise<number> {
  const { _sum } = await prisma.karma.aggregate({
    _sum: { amount: true },
    where: { receiverId: id, guildId },
  });
  return _sum.amount ?? 0;
}
