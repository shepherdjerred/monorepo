import type { Db } from "#src/database/index.ts";
import type { CustomOperationPayload } from "#src/customs/operations/contracts.ts";
import { customGameParticipantWrite } from "#src/customs/game/game-context.ts";
import type { CustomOperationExecution } from "#src/customs/operations/execution-steps.ts";

async function finishDomain(
  tx: Db,
  payload: CustomOperationPayload,
  now: Date,
): Promise<void> {
  const nightId = payload.snapshot.id;
  const game = payload.snapshot.currentGame;
  if (payload.action === "arrange") {
    if (game === null)
      throw new Error("Arranging voice requires a frozen game");
    await tx.customGame.update({
      where: { id: game.id },
      data: { voiceState: "READY", voiceReady: true, voiceError: null },
    });
    return;
  }
  await tx.customNight.update({
    where: { id: nightId },
    data: { teamAVoiceChannelId: null, teamBVoiceChannelId: null },
  });
  if (game !== null)
    await tx.customGame.update({
      where: { id: game.id },
      data: { voiceState: "CLEANED_UP", voiceReady: false, voiceError: null },
    });
  if (payload.action === "continue") {
    if (game === null || payload.nextGame === undefined)
      throw new Error("Continuing requires a frozen next game");
    await tx.customGame.create({
      data: {
        id: payload.nextGame.id,
        nightId,
        sequence: game.sequence + 1,
        state: "CAPTAINS_SET",
        rosterMode: game.rosterMode,
        map: game.map,
        pickMode: game.pickMode,
        participants: {
          create: payload.nextGame.participants.map((participant) =>
            customGameParticipantWrite(participant),
          ),
        },
      },
    });
    await tx.customNight.update({
      where: { id: nightId },
      data: { state: "PREPARING" },
    });
  }
  if (
    game !== null &&
    ["void", "end", "expire"].includes(payload.action) &&
    !["VERIFIED", "VOID"].includes(game.state)
  ) {
    await tx.customGame.update({
      where: { id: game.id },
      data: { state: "VOID", completedAt: now },
    });
    await tx.customNight.update({
      where: { id: nightId },
      data: { state: "INTERMISSION" },
    });
  }
  if (payload.action === "end" || payload.action === "expire") {
    await tx.customNight.update({
      where: { id: nightId },
      data: { state: "ENDED", endedAt: now, lastActivityAt: now },
    });
    await tx.customActiveNight.deleteMany({ where: { nightId } });
  }
}

export async function completeCustomOperation(
  context: CustomOperationExecution,
): Promise<void> {
  const { db, operationId, payload, progress, fence, cancellation } = context;
  await fence.assertHeld();
  cancellation?.throwIfAborted();
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "CustomNightOperation" WHERE "id" = ${operationId} FOR UPDATE`;
    const standing = await tx.customNightOperation.findUniqueOrThrow({
      where: { id: operationId },
    });
    if (standing.state === "completed") return;
    if (!["queued", "running"].includes(standing.state))
      throw new Error("Custom operation lost its completion fence");
    await finishDomain(tx, payload, new Date());
    progress.step = "Completed";
    await tx.customNightOperation.update({
      where: { id: operationId },
      data: {
        state: "completed",
        progress: JSON.stringify(progress),
        outcome: JSON.stringify({ version: 1, state: "completed" }),
      },
    });
    const night = await tx.customNight.update({
      where: { id: standing.nightId },
      data: { revision: { increment: 1 } },
    });
    await tx.customAuditEvent.create({
      data: {
        nightId: night.id,
        revision: night.revision,
        actorId: standing.actorDiscordId,
        action: "OPERATION_COMPLETED",
        payload: JSON.stringify({
          operationId,
          action: payload.action,
          reason: payload.reason ?? null,
        }),
        source: "TEMPORAL",
      },
    });
  });
}
