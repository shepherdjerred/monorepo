import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { withScoutEffectFence } from "#src/temporal/effect-fence.ts";
import { CustomOperationProgressSchema } from "#src/customs/operations/contracts.ts";

/** End an expired night while preserving uncertain voice effects for inspection. */
export async function expireHeldCustomOperation(
  db: ExtendedPrismaClient,
  operationId: string,
  now: Date,
): Promise<boolean> {
  return await withScoutEffectFence(
    `custom-operation:${operationId}`,
    async (fence) => {
      await fence.assertHeld();
      return await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "CustomNightOperation" WHERE "id"=${operationId} FOR UPDATE`;
        const operation = await tx.customNightOperation.findUniqueOrThrow({
          where: { id: operationId },
        });
        if (operation.state !== "held") return false;
        const night = await tx.customNight.findUniqueOrThrow({
          where: { id: operation.nightId },
        });
        if (night.state === "ENDED" || night.expiresAt > now) return false;
        const progress = CustomOperationProgressSchema.parse(
          JSON.parse(operation.progress),
        );
        if (progress.creating === null)
          throw new Error("Held Customs operation has no uncertain creation");
        progress.expiredAt = now.toISOString();
        progress.moved = [];
        progress.step =
          "Night expired; confirm uncertain creation before voice cleanup";
        const revision = night.revision + 1;
        const changed = await tx.customNight.updateMany({
          where: {
            id: night.id,
            revision: night.revision,
            state: { not: "ENDED" },
            expiresAt: { lte: now },
          },
          data: { state: "ENDED", endedAt: now, lastActivityAt: now, revision },
        });
        if (changed.count !== 1) return false;
        const game = await tx.customGame.findFirst({
          where: { nightId: night.id },
          orderBy: { sequence: "desc" },
        });
        if (game !== null && !["VERIFIED", "VOID"].includes(game.state)) {
          await tx.customGame.update({
            where: { id: game.id },
            data: {
              state: "VOID",
              completedAt: now,
              voiceReady: false,
              voiceError:
                "Night expired; uncertain voice creation needs manager review",
            },
          });
          await tx.customAuditEvent.create({
            data: {
              nightId: night.id,
              gameId: game.id,
              revision,
              actorId: "temporal:custom-nights-expiry",
              action: "GAME_VOIDED",
              payload: JSON.stringify({
                reason: "Custom night expired",
                operationId,
              }),
              source: "TEMPORAL",
            },
          });
        }
        await tx.customNightOperation.update({
          where: { id: operationId },
          data: { progress: JSON.stringify(progress) },
        });
        await tx.customActiveNight.deleteMany({ where: { nightId: night.id } });
        await tx.customAuditEvent.create({
          data: {
            nightId: night.id,
            revision,
            actorId: "temporal:custom-nights-expiry",
            action: "NIGHT_EXPIRED",
            payload: JSON.stringify({
              expiredAt: now.toISOString(),
              operationId,
              cleanupHeld: true,
            }),
            source: "TEMPORAL",
          },
        });
        return true;
      });
    },
    { database: db },
  );
}
