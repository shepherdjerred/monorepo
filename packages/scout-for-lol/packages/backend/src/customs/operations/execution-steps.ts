import type { ExtendedPrismaClient } from "#src/database/index.ts";
import type { ScoutEffectFence } from "#src/temporal/effect-fence.ts";
import { DiscordChannelIdSchema } from "@scout-for-lol/domain/identity/discord.ts";
import {
  CustomOperationProgressSchema,
  type CustomOperationPayload,
  type CustomOperationProgress,
} from "#src/customs/operations/contracts.ts";

export type CustomVoicePort = {
  assertReady: () => void;
  createTeam: (team: "A" | "B") => Promise<string>;
  move: (
    discordId: string,
    sources: ReadonlySet<string>,
    destinationId: string,
  ) => Promise<void>;
  deleteChannel: (channelId: string) => Promise<void>;
};
export type CustomOperationExecution = {
  db: ExtendedPrismaClient;
  operationId: string;
  payload: CustomOperationPayload;
  progress: CustomOperationProgress;
  fence: ScoutEffectFence;
  cancellation: AbortSignal | undefined;
};

export async function persistCustomProgress(
  context: CustomOperationExecution,
  state: "running" | "held" = "running",
): Promise<void> {
  const { db, operationId, progress, fence } = context;
  await fence.assertHeld();
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "CustomNightOperation" WHERE "id" = ${operationId} FOR UPDATE`;
    const operation = await tx.customNightOperation.findUniqueOrThrow({
      where: { id: operationId },
    });
    if (!["queued", "running"].includes(operation.state))
      throw new Error("Custom operation no longer owns its progress");
    await tx.customNightOperation.update({
      where: { id: operationId },
      data: {
        state,
        progress: JSON.stringify(CustomOperationProgressSchema.parse(progress)),
      },
    });
    const night = await tx.customNight.update({
      where: { id: operation.nightId },
      data: {
        revision: { increment: 1 },
        ...(operation.action === "arrange"
          ? {
              teamAVoiceChannelId: progress.channels.A ?? null,
              teamBVoiceChannelId: progress.channels.B ?? null,
            }
          : {}),
      },
    });
    await tx.customAuditEvent.create({
      data: {
        nightId: operation.nightId,
        revision: night.revision,
        actorId: operation.actorDiscordId,
        action: state === "held" ? "OPERATION_HELD" : "OPERATION_PROGRESS",
        payload: JSON.stringify({ operationId, step: progress.step }),
        source: "TEMPORAL",
      },
    });
  });
}

async function assertExternalWrite(
  context: CustomOperationExecution,
  port: CustomVoicePort,
): Promise<void> {
  await context.fence.assertHeld();
  context.cancellation?.throwIfAborted();
  port.assertReady();
}

export async function provisionCustomTeams(
  context: CustomOperationExecution,
  port: CustomVoicePort,
): Promise<"ready" | "held"> {
  const { progress, cancellation } = context;
  for (const team of ["A", "B"] as const) {
    if (progress.channels[team] !== undefined) continue;
    cancellation?.throwIfAborted();
    progress.creating = team;
    progress.step = `Creating Team ${team} voice channel`;
    await persistCustomProgress(context);
    await assertExternalWrite(context, port);
    let channelId: string;
    try {
      channelId = await port.createTeam(team);
    } catch {
      progress.step = `Team ${team} creation needs confirmation before resuming`;
      await persistCustomProgress(context, "held");
      return "held";
    }
    // Record known success even if cancellation arrived during the request.
    // If this commit fails, the durable creating marker holds the next retry.
    progress.channels[team] = DiscordChannelIdSchema.parse(channelId);
    progress.creating = null;
    progress.step = `Team ${team} voice channel recorded`;
    await persistCustomProgress(context);
  }
  return "ready";
}

function recordedChannels(context: CustomOperationExecution) {
  return {
    A:
      context.progress.channels.A ??
      context.payload.snapshot.teamAVoiceChannelId,
    B:
      context.progress.channels.B ??
      context.payload.snapshot.teamBVoiceChannelId,
  };
}

function participantDestination(
  context: CustomOperationExecution,
  team: "A" | "B" | null,
): string {
  if (context.payload.action !== "arrange")
    return context.payload.snapshot.voiceLobbyChannelId;
  const teams = recordedChannels(context);
  const destination = team === "A" ? teams.A : teams.B;
  if (destination === null)
    throw new Error("Custom operation has no recorded destination");
  return destination;
}

export async function moveCustomParticipants(
  context: CustomOperationExecution,
  port: CustomVoicePort,
): Promise<void> {
  const { payload, progress } = context;
  const teams = recordedChannels(context);
  const sources = new Set<string>();
  for (const id of [teams.A, teams.B]) if (id !== null) sources.add(id);
  if (payload.action === "arrange")
    sources.add(payload.snapshot.voiceLobbyChannelId);
  for (const participant of payload.snapshot.currentGame?.participants ?? []) {
    if (payload.action === "arrange" && participant.team === null) continue;
    if (progress.moved.includes(participant.discordId)) continue;
    const destination = participantDestination(context, participant.team);
    await assertExternalWrite(context, port);
    await port.move(participant.discordId, sources, destination);
    progress.moved.push(participant.discordId);
    progress.step = `Processed ${progress.moved.length.toString()} voice participants`;
    await persistCustomProgress(context);
  }
}

export async function deleteCustomTeams(
  context: CustomOperationExecution,
  port: CustomVoicePort,
): Promise<void> {
  if (context.payload.action === "arrange") return;
  const channels = recordedChannels(context);
  for (const channelId of new Set([channels.A, channels.B])) {
    if (channelId === null || context.progress.deleted.includes(channelId))
      continue;
    await assertExternalWrite(context, port);
    await port.deleteChannel(channelId);
    context.progress.deleted.push(channelId);
    context.progress.step = "Returning voice to the lobby";
    await persistCustomProgress(context);
  }
}
