import type { Prisma } from "#generated/prisma/client/index.js";
import { pendingDareCalloutRefresh } from "#src/dares/presentation/dare-callout-refresh-state.ts";
import {
  mintDareResultIntent,
  mintDareStatusIntents,
  type DareNotificationDisposition,
} from "#src/dares/presentation/notify/dare-status-intent.ts";
import { announceOrWithholdDare } from "#src/dares/settlement/dare-announcement.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { DiscordAccountIdSchema } from "@scout-for-lol/data";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
export type VoidableDareRow = Prisma.DareGetPayload<{
  include: { targets: true };
}>;
export async function voidDare(
  dare: VoidableDareRow,
  reason:
    | "invalid_contract"
    | "unknown_evaluator"
    | "target_unavailable"
    | "activation_timeout"
    | "insufficient_baseline"
    | "version_retired",
  prismaClient: ExtendedPrismaClient = prisma,
  options: {
    now?: Date;
    notify?: DareNotificationDisposition;
    matchId?: RiotMatchId | undefined;
  } = {},
): Promise<boolean> {
  const now = options.now ?? new Date();
  return await prismaClient.$transaction(async (tx) => {
    const claim = await tx.dare.updateMany({
      where: { id: dare.id, dareState: { in: ["active", "activating"] } },
      data: {
        dareState: "voided",
        settledAt: now,
        settledMatchId: options.matchId ?? null,
        finalValue: null,
        voidReason: reason,
        ...pendingDareCalloutRefresh(),
      },
    });
    if (claim.count !== 1) return false;
    const revisionNumber = dare.publishedRevision ?? dare.currentRevision;
    const revision = await tx.dareRevision.findUniqueOrThrow({
      where: { dareId_revision: { dareId: dare.id, revision: revisionNumber } },
      select: { plainLanguage: true },
    });
    await announceOrWithholdDare(
      tx,
      { dareId: dare.id, notify: options.notify ?? "enqueue" },
      async () => {
        await mintDareResultIntent(tx, {
          dareId: dare.id,
          revision: revisionNumber,
          result: {
            resolution: "voided",
            challengerDiscordId: DiscordAccountIdSchema.parse(
              dare.challengerDiscordId,
            ),
            plainLanguage: revision.plainLanguage,
            winners: [],
            voidReason: reason,
          },
          occurredAt: now,
        });
        await mintDareStatusIntents(tx, {
          dareId: dare.id,
          revision: revisionNumber,
          category: "lifecycle",
          kind: "voided",
          summary: "The Dare was voided (" + reason.replaceAll("_", " ") + ").",
          deduplicationKey:
            "dare:" +
            dare.id.toString() +
            ":revision:" +
            revisionNumber.toString() +
            ":voided",
          occurredAt: now,
        });
      },
    );
    return true;
  });
}
