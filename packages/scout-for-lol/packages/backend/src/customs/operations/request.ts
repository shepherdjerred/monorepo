import type { z } from "zod";
import {
  CustomIntermissionChoiceSchema,
  type CustomActivityClaims,
  type CustomNightSnapshot,
} from "@scout-for-lol/data";
import {
  SCOUT_WORKFLOW_NAMES,
  scoutCustomOperationWorkflowId,
  type ScoutCustomOperationAction,
} from "@scout-for-lol/temporal";
import { IsoInstantSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import configuration from "#src/configuration.ts";
import { requestWorkflowStart } from "#src/database/durable/workflow-start-repository.ts";
import { customActivityActor } from "#src/customs/activity/activity-actor.ts";
import { assertCustomManager } from "#src/customs/activity/activity-mutation-context.ts";
import { buildCustomNightSnapshot } from "#src/customs/snapshot.ts";
import { nextCustomGameParticipants } from "#src/customs/game/next-game-participants.ts";
import { orchestrationMode } from "#src/temporal/orchestration-cutover.ts";
import {
  CustomOperationPayloadSchema,
  initialCustomOperationProgress,
  type CustomOperationPayload,
} from "#src/customs/operations/contracts.ts";

export type CustomOperationRequest = {
  nightId: string;
  expectedRevision: number;
  choice?: z.infer<typeof CustomIntermissionChoiceSchema>;
  reason?: string;
};

function assertArrangeReady(snapshot: CustomNightSnapshot): void {
  const game = snapshot.currentGame;
  if (
    snapshot.teamAVoiceChannelId !== null ||
    snapshot.teamBVoiceChannelId !== null ||
    game?.voiceReady === true
  )
    throw new Error(
      "Return the existing team voice channels before arranging new ones",
    );
  if (
    game?.state !== "LOBBY_READY" ||
    ["A", "B"].some(
      (team) =>
        game.participants.filter((participant) => participant.team === team)
          .length !== 5,
    )
  )
    throw new Error(
      "The lobby and both teams must be ready before arranging voice",
    );
}

function preparePayload(
  snapshot: CustomNightSnapshot,
  action: ScoutCustomOperationAction,
  input: CustomOperationRequest,
): CustomOperationPayload {
  if (snapshot.state === "ENDED")
    throw new Error("Custom night has already ended");
  if (action === "arrange") assertArrangeReady(snapshot);
  const game = snapshot.currentGame;
  const canContinue =
    game !== null &&
    ["VERIFIED", "VOID"].includes(game.state) &&
    snapshot.state === "INTERMISSION";
  if (action === "continue" && !canContinue)
    throw new Error(
      "The current game must be verified or voided before continuing",
    );
  if (
    action === "void" &&
    (game === null || ["VERIFIED", "VOID"].includes(game.state))
  )
    throw new Error("The current game is already terminal");
  const choice =
    action === "continue"
      ? CustomIntermissionChoiceSchema.parse(input.choice)
      : undefined;
  return CustomOperationPayloadSchema.parse({
    version: 1,
    action,
    snapshot,
    ...(choice === undefined
      ? {}
      : {
          choice,
          nextGame: {
            id: crypto.randomUUID(),
            participants: nextCustomGameParticipants(
              game?.participants ?? [],
              choice,
            ),
          },
        }),
    ...(input.reason === undefined ? {} : { reason: input.reason }),
  });
}

/** The domain revision, authorized operation and Temporal start commit together. */
export async function commitCustomOperation(
  db: ExtendedPrismaClient,
  snapshot: CustomNightSnapshot,
  command: {
    actorDiscordId: string;
    action: ScoutCustomOperationAction;
    input: CustomOperationRequest;
    now: Date;
  },
): Promise<string> {
  const { actorDiscordId, action, input, now } = command;
  const id = `${input.nightId}:${input.expectedRevision.toString()}:${action}`;
  const payload = preparePayload(snapshot, action, input);
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "CustomNight" WHERE "id" = ${input.nightId} FOR UPDATE`;
    const existing = await tx.customNightOperation.findUnique({
      where: { id },
    });
    if (existing !== null) {
      const saved = CustomOperationPayloadSchema.parse(
        JSON.parse(existing.payload),
      );
      if (
        existing.actorDiscordId !== actorDiscordId ||
        saved.choice !== input.choice ||
        saved.reason !== input.reason
      )
        throw new Error(
          "Custom operation identity conflicts with a previous request",
        );
      return;
    }
    const advanced = await tx.customNight.updateMany({
      where: {
        id: input.nightId,
        guildId: snapshot.guildId,
        revision: input.expectedRevision,
        state: { not: "ENDED" },
        operations: { none: { state: { in: ["queued", "running", "held"] } } },
      },
      data: { revision: { increment: 1 }, lastActivityAt: now },
    });
    if (advanced.count !== 1)
      throw new Error(
        "Custom night revision is stale or another operation is pending",
      );
    await tx.customNightOperation.create({
      data: {
        id,
        nightId: input.nightId,
        expectedRevision: input.expectedRevision,
        actorDiscordId,
        action,
        payload: JSON.stringify(payload),
        progress: JSON.stringify(initialCustomOperationProgress()),
      },
    });
    await tx.customAuditEvent.create({
      data: {
        nightId: input.nightId,
        revision: input.expectedRevision + 1,
        actorId: actorDiscordId,
        action: "OPERATION_QUEUED",
        payload: JSON.stringify({ operationId: id, action }),
        source: action === "expire" ? "TEMPORAL" : "ACTIVITY",
      },
    });
    const stage = configuration.temporalNamespace;
    const requested = await requestWorkflowStart(tx, {
      requestedWorkflowId: scoutCustomOperationWorkflowId(stage, id),
      workflowType: SCOUT_WORKFLOW_NAMES.customOperation,
      requestedBy: null,
      requestSource: "customs-operation",
      requestedAt: IsoInstantSchema.parse(now.toISOString()),
      inputPayload: {
        kind: SCOUT_WORKFLOW_NAMES.customOperation,
        version: 1,
        data: { stage, operationId: id },
      },
    });
    if (requested.outcome === "conflict")
      throw new Error("Customs operation start has conflicting facts");
  });
  return id;
}

/** null selects the compatibility path; once activated, flag-off pauses new work. */
export async function requestDurableCustomOperation(
  claims: CustomActivityClaims,
  action: ScoutCustomOperationAction,
  input: CustomOperationRequest,
): Promise<CustomNightSnapshot | null> {
  const mode = await orchestrationMode();
  if (mode === "legacy") return null;
  if (mode === "paused") throw new Error("New Customs operations are paused");
  const actor = await customActivityActor(claims);
  const snapshot = await buildCustomNightSnapshot(
    prisma,
    input.nightId,
    actor.discordId,
    { viewerAdministrator: actor.administrator },
  );
  if (snapshot?.guildId !== actor.guildId)
    throw new Error("Custom night does not belong to this guild");
  assertCustomManager(snapshot, actor);
  const id = `${input.nightId}:${input.expectedRevision.toString()}:${action}`;
  const existing = await prisma.customNightOperation.findUnique({
    where: { id },
  });
  if (existing === null) {
    if (snapshot.revision !== input.expectedRevision)
      throw new Error("Custom night revision is stale");
    await commitCustomOperation(prisma, snapshot, {
      actorDiscordId: actor.discordId,
      action,
      input,
      now: new Date(),
    });
  } else {
    const saved = CustomOperationPayloadSchema.parse(
      JSON.parse(existing.payload),
    );
    if (
      existing.actorDiscordId !== actor.discordId ||
      saved.choice !== input.choice ||
      saved.reason !== input.reason
    )
      throw new Error(
        "Custom operation identity conflicts with a previous request",
      );
  }
  const pending = await buildCustomNightSnapshot(
    prisma,
    input.nightId,
    actor.discordId,
    { viewerAdministrator: actor.administrator },
  );
  if (pending === undefined)
    throw new Error("Custom night disappeared after queuing its operation");
  return pending;
}
