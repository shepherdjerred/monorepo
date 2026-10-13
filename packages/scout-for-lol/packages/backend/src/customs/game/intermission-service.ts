import {
  AccountIdSchema,
  DiscordAccountIdSchema,
  LeaguePuuidSchema,
  PlayerIdSchema,
  type CustomActivityClaims,
  type CustomGameParticipant,
  type CustomIntermissionChoice,
  type CustomNightSnapshot,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import { customActivityActor } from "#src/customs/activity/activity-actor.ts";
import {
  canManageCustomNight,
  customRoleFor,
} from "#src/customs/authorization.ts";
import { nextCustomGameParticipants } from "#src/customs/game/next-game-participants.ts";
import { commitCustomMutation } from "#src/customs/repository.ts";
import { buildCustomNightSnapshot } from "#src/customs/snapshot.ts";
import { publishCustomNightSnapshot } from "#src/customs/socket.ts";
import { returnCustomVoiceToLobby } from "#src/customs/voice-service.ts";
import { requestDurableCustomOperation } from "#src/customs/operations/request.ts";

type ContinueInput = {
  readonly nightId: string;
  readonly expectedRevision: number;
  readonly choice: CustomIntermissionChoice;
};

function participantWrite(participant: CustomGameParticipant) {
  return {
    ...participant,
    discordId: DiscordAccountIdSchema.parse(participant.discordId),
    playerId: PlayerIdSchema.parse(participant.playerId),
    accountId: AccountIdSchema.parse(participant.accountId),
    puuid: LeaguePuuidSchema.parse(participant.puuid),
    championId: null,
    won: null,
  };
}

async function requireIntermission(
  claims: CustomActivityClaims,
  input: ContinueInput,
): Promise<CustomNightSnapshot> {
  const actor = await customActivityActor(claims);
  const snapshot = await buildCustomNightSnapshot(
    prisma,
    input.nightId,
    actor.discordId,
    { viewerAdministrator: actor.administrator },
  );
  if (snapshot === undefined) throw new Error("Custom night does not exist");
  if (snapshot.revision !== input.expectedRevision)
    throw new Error("Custom night revision is stale");
  if (snapshot.guildId !== actor.guildId)
    throw new Error("Custom night belongs to a different guild");
  if (
    !canManageCustomNight(
      customRoleFor(snapshot, actor.discordId, actor.administrator),
    )
  ) {
    throw new Error("Only the host or a cohost can continue the night");
  }
  if (
    snapshot.state !== "INTERMISSION" ||
    (snapshot.currentGame?.state !== "VERIFIED" &&
      snapshot.currentGame?.state !== "VOID")
  ) {
    throw new Error(
      "The current game must be Riot-verified or explicitly voided",
    );
  }
  return snapshot;
}

export async function continueCustomNight(
  claims: CustomActivityClaims,
  input: ContinueInput,
): Promise<CustomNightSnapshot> {
  const pending = await requestDurableCustomOperation(
    claims,
    "continue",
    input,
  );
  if (pending !== null) return pending;
  let snapshot = await requireIntermission(claims, input);
  if (
    snapshot.teamAVoiceChannelId !== null ||
    snapshot.teamBVoiceChannelId !== null
  ) {
    snapshot = await returnCustomVoiceToLobby(claims, {
      nightId: input.nightId,
      expectedRevision: snapshot.revision,
    });
  }
  const actor = await customActivityActor(claims);
  const previous = snapshot.currentGame;
  if (previous === null) throw new Error("Intermission has no completed game");
  const participants = nextCustomGameParticipants(
    previous.participants,
    input.choice,
  );
  const gameId = globalThis.crypto.randomUUID();
  const sequence = previous.sequence + 1;
  const captains = participants
    .filter((participant) => participant.captain)
    .map((participant) => ({
      discordId: participant.discordId,
      team: participant.team,
    }));
  await commitCustomMutation(
    prisma,
    {
      nightId: input.nightId,
      expectedRevision: snapshot.revision,
      actorId: actor.discordId,
      action: "INTERMISSION_CONTINUED",
      payload: {
        choice: input.choice,
        gameId,
        sequence,
        captains,
      },
      source: "ACTIVITY",
      now: new Date(),
      gameId,
    },
    async (transaction) => {
      await transaction.customGame.create({
        data: {
          id: gameId,
          nightId: input.nightId,
          sequence,
          state: "CAPTAINS_SET",
          rosterMode: previous.rosterMode,
          map: previous.map,
          pickMode: previous.pickMode,
          participants: {
            create: participants.map((participant) =>
              participantWrite(participant),
            ),
          },
        },
      });
      await transaction.customNight.update({
        where: { id: input.nightId },
        data: { state: "PREPARING" },
      });
    },
  );
  await publishCustomNightSnapshot(input.nightId);
  const updated = await buildCustomNightSnapshot(
    prisma,
    input.nightId,
    actor.discordId,
    { viewerAdministrator: actor.administrator },
  );
  if (updated === undefined) throw new Error("Custom night disappeared");
  return updated;
}
