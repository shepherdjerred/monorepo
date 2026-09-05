import type { DiscordAccountId } from "@scout-for-lol/data";
import type { ConfirmationIntent } from "#generated/prisma/client/index.js";
import type { Db, ExtendedPrismaClient } from "#src/database/index.ts";

export type ClaimConfirmationIntentInput = {
  intentId: string;
  actorDiscordId: DiscordAccountId;
  now: Date;
};

export type ClaimRefusal =
  { kind: "intent_expired" } | { kind: "already_consumed"; result: unknown };

/**
 * Claims an intent for exactly one confirmation and runs the real action in
 * the same transaction.
 *
 * The guarded write is deliberately the first statement in the transaction: it
 * is the whole double-spend guard. Two concurrent confirmations both open a
 * transaction, but only one of them updates a row, and the loser learns that
 * from the empty result before it has done anything. Reading the intent first
 * and deciding afterwards would let both pass the check, so the claimed row is
 * taken from the guarded write itself rather than re-read.
 *
 * The result of `run` is persisted on the intent, so a later confirmation of
 * the same intent replays the original outcome instead of acting again.
 */
export async function claimAndExecute<Result>(
  prismaClient: ExtendedPrismaClient,
  input: ClaimConfirmationIntentInput,
  run: (tx: Db, intent: ConfirmationIntent) => Promise<Result>,
): Promise<Result | ClaimRefusal> {
  return await prismaClient.$transaction(async (tx) => {
    const claimed = await tx.confirmationIntent.updateManyAndReturn({
      where: {
        id: input.intentId,
        actorDiscordId: input.actorDiscordId,
        consumedAt: null,
        expiresAt: { gt: input.now },
      },
      data: { consumedAt: input.now },
    });
    const intent = claimed[0];
    if (intent === undefined || claimed.length !== 1) {
      const current = await tx.confirmationIntent.findUniqueOrThrow({
        where: { id: input.intentId },
      });
      return current.consumedAt === null
        ? ({ kind: "intent_expired" } as const)
        : ({
            kind: "already_consumed",
            result:
              current.resultJson === null
                ? null
                : JSON.parse(current.resultJson),
          } as const);
    }
    const result = await run(tx, intent);
    await tx.confirmationIntent.update({
      where: { id: input.intentId },
      data: { resultJson: JSON.stringify(result) },
    });
    return result;
  });
}
