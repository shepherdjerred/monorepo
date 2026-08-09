/** Karma persistence, shared by every entry point that can award karma:
 *  the slash command, the message context menu, and reactions. Keeping the
 *  writes in one place means new surfaces cannot drift from the scoring rules
 *  or forget to create the `person` rows the foreign keys need. */
import { prisma } from "#src/db/index.ts";

/** Ensure a `person` row exists so the karma foreign keys resolve. */
export async function ensurePerson(id: string): Promise<void> {
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
export async function recordKarma(params: RecordKarmaParams): Promise<void> {
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

  if (params.sourceMessageId === undefined) {
    await prisma.karma.create({ data });
    return;
  }

  await prisma.karma.upsert({
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
