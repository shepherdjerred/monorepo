import {
  CustomNightStateSchema,
  type AccountId,
  type CustomActivityClaims,
  type CustomNightSnapshot,
  type DiscordAccountId,
} from "@scout-for-lol/data";
import {
  assertCustomManager as assertManager,
  customMutationContext as mutationContext,
  customSnapshotForActorAfterMutation as afterMutation,
  type CustomRevisionInput as RevisionInput,
} from "#src/customs/activity-mutation-context.ts";
import {
  commitCustomMutation,
  mutateCustomNight,
} from "#src/customs/repository.ts";
import { voidCustomGame } from "#src/customs/game-operation-service.ts";
import { returnCustomVoiceToLobby } from "#src/customs/voice-service.ts";
import { prisma } from "#src/database/index.ts";

export async function selectCustomAccount(
  claims: CustomActivityClaims,
  input: RevisionInput & {
    accountId: AccountId;
    targetDiscordId?: DiscordAccountId | undefined;
  },
): Promise<CustomNightSnapshot> {
  const context = await mutationContext(claims, input, false);
  const targetDiscordId = input.targetDiscordId ?? context.actor.discordId;
  if (targetDiscordId !== context.actor.discordId) {
    assertManager(context.snapshot, context.actor);
  }
  const participant = context.snapshot.participants.find(
    (candidate) => candidate.discordId === targetDiscordId,
  );
  if (
    participant?.accounts.some(
      (account) => account.accountId === input.accountId,
    ) !== true
  ) {
    throw new Error(
      "Selected Riot account does not belong to this participant",
    );
  }
  await commitCustomMutation(
    prisma,
    {
      ...input,
      actorId: context.actor.discordId,
      action: "ACCOUNT_SELECTED",
      payload: { discordId: targetDiscordId, accountId: input.accountId },
      source: "ACTIVITY",
      now: new Date(),
    },
    async (transaction) => {
      await transaction.customNightParticipant.update({
        where: {
          nightId_discordId: {
            nightId: input.nightId,
            discordId: targetDiscordId,
          },
        },
        data: { selectedAccountId: input.accountId },
      });
    },
  );
  return afterMutation(input.nightId, context.actor);
}

export async function prepareCustomNight(
  claims: CustomActivityClaims,
  input: RevisionInput,
): Promise<CustomNightSnapshot> {
  const { actor, snapshot } = await mutationContext(claims, input, true);
  if (snapshot.state !== "RECRUITING") {
    throw new Error("Only a recruiting night can enter preparation");
  }
  if (snapshot.participants.length < 10) {
    throw new Error(
      "At least ten participants are required to prepare a night",
    );
  }
  await mutateCustomNight(prisma, {
    ...input,
    actorId: actor.discordId,
    action: "NIGHT_PREPARING",
    payload: {},
    source: "ACTIVITY",
    state: CustomNightStateSchema.parse("PREPARING"),
    now: new Date(),
  });
  return afterMutation(input.nightId, actor);
}

export async function endCustomNight(
  claims: CustomActivityClaims,
  input: RevisionInput,
): Promise<CustomNightSnapshot> {
  const { actor, snapshot: initialSnapshot } = await mutationContext(
    claims,
    input,
    true,
  );
  let snapshot = initialSnapshot;
  if (
    snapshot.currentGame !== null &&
    !["VERIFIED", "VOID"].includes(snapshot.currentGame.state)
  ) {
    snapshot = await voidCustomGame(claims, {
      nightId: input.nightId,
      expectedRevision: snapshot.revision,
      reason: "Night ended by a manager",
    });
  }
  if (
    snapshot.teamAVoiceChannelId !== null ||
    snapshot.teamBVoiceChannelId !== null
  ) {
    snapshot = await returnCustomVoiceToLobby(claims, {
      nightId: input.nightId,
      expectedRevision: snapshot.revision,
    });
  }
  await mutateCustomNight(prisma, {
    nightId: input.nightId,
    expectedRevision: snapshot.revision,
    actorId: actor.discordId,
    action: "NIGHT_ENDED",
    payload: {},
    source: "ACTIVITY",
    state: CustomNightStateSchema.parse("ENDED"),
    now: new Date(),
  });
  return afterMutation(input.nightId, actor);
}
