import {
  CustomResolveVoiceOperationInputSchema,
  type CustomActivityClaims,
  type CustomResolveVoiceOperationInput,
} from "@scout-for-lol/data";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { botRest } from "#src/lib/discord/bot-rest.ts";
import type { DiscordGuildChannel } from "#src/lib/discord/bot-rest-schemas.ts";
import { customActivityActor } from "#src/customs/activity/activity-actor.ts";
import { assertCustomManager } from "#src/customs/activity/activity-mutation-context.ts";
import { buildCustomNightSnapshot } from "#src/customs/snapshot.ts";
import { withScoutEffectFence } from "#src/temporal/effect-fence.ts";
import {
  CustomOperationPayloadSchema,
  CustomOperationProgressSchema,
} from "#src/customs/operations/contracts.ts";
import { customTeamChannelName } from "#src/customs/operations/channel-name.ts";

/** The caller authorizes the actor; this layer revalidates exact external evidence under the execution fence. */
export async function commitCustomVoiceResolution(
  db: ExtendedPrismaClient,
  input: CustomResolveVoiceOperationInput,
  actorDiscordId: string,
  readFreshChannels: () => Promise<DiscordGuildChannel[] | null>,
): Promise<void> {
  await withScoutEffectFence(
    `custom-operation:${input.operationId}`,
    async (fence) => {
      const operation = await db.customNightOperation.findUniqueOrThrow({
        where: { id: input.operationId },
      });
      if (operation.nightId !== input.nightId || operation.state !== "held")
        throw new Error("This Customs operation is not awaiting resolution");
      const payload = CustomOperationPayloadSchema.parse(
        JSON.parse(operation.payload),
      );
      const progress = CustomOperationProgressSchema.parse(
        JSON.parse(operation.progress),
      );
      if (progress.creating === null || payload.snapshot.currentGame === null)
        throw new Error("This operation has no uncertain channel creation");
      const channels = await readFreshChannels();
      if (channels === null)
        throw new Error("Scout cannot inspect this server's current channels");
      const expectedName = customTeamChannelName(
        operation.id,
        payload.snapshot.currentGame.sequence,
        progress.creating,
      );
      const matches = channels.filter(
        (channel) => channel.name === expectedName && channel.type === 2,
      );
      if (input.answer.kind === "confirmed-unsent") {
        if (matches.length > 0)
          throw new Error(
            "A matching team channel exists; record that channel instead of creating another",
          );
      } else {
        if (matches.length !== 1 || matches[0]?.id !== input.answer.channelId)
          throw new Error(
            "The selected channel does not uniquely match this operation",
          );
        progress.channels[progress.creating] = input.answer.channelId;
      }
      progress.creating = null;
      progress.step = "Confirmed by a manager; waiting to resume";
      await fence.assertHeld();
      await db.$transaction(async (tx) => {
        const night = await tx.customNight.updateMany({
          where: {
            id: input.nightId,
            revision: input.expectedRevision,
            state:
              progress.expiredAt === undefined ? { not: "ENDED" } : "ENDED",
          },
          data: {
            revision: { increment: 1 },
            teamAVoiceChannelId: progress.channels.A ?? null,
            teamBVoiceChannelId: progress.channels.B ?? null,
          },
        });
        if (night.count !== 1)
          throw new Error(
            "Custom night revision changed while inspecting the channel",
          );
        const changed = await tx.customNightOperation.updateMany({
          where: { id: input.operationId, state: "held" },
          data: { state: "queued", progress: JSON.stringify(progress) },
        });
        if (changed.count !== 1)
          throw new Error("Custom operation was already resolved");
        await tx.customAuditEvent.create({
          data: {
            nightId: input.nightId,
            revision: input.expectedRevision + 1,
            actorId: actorDiscordId,
            action: "OPERATION_CREATION_RESOLVED",
            payload: JSON.stringify({
              operationId: input.operationId,
              answer: input.answer,
              evidence: input.evidence,
            }),
            source: "OPERATOR",
          },
        });
      });
    },
    { database: db },
  );
}

export async function resolveCustomVoiceOperation(
  claims: CustomActivityClaims,
  rawInput: CustomResolveVoiceOperationInput,
) {
  const input = CustomResolveVoiceOperationInputSchema.parse(rawInput);
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
  await commitCustomVoiceResolution(
    prisma,
    input,
    actor.discordId,
    async () => await botRest().freshGuildChannels(actor.guildId),
  );
  const updated = await buildCustomNightSnapshot(
    prisma,
    input.nightId,
    actor.discordId,
    { viewerAdministrator: actor.administrator },
  );
  if (updated === undefined)
    throw new Error("Custom night disappeared after resolution");
  return updated;
}
