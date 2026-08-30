import {
  AccountIdSchema,
  DiscordAccountIdSchema,
  LeaguePuuidSchema,
  PlayerIdSchema,
  type CustomActivityClaims,
  type CustomGameParticipant,
  type CustomNightSnapshot,
} from "@scout-for-lol/data";
import {
  customMutationContext,
  requiredCustomSnapshot,
  type CustomRevisionInput,
} from "#src/customs/activity-mutation-context.ts";
import type { CustomActivityActor } from "#src/customs/activity-actor.ts";
import { publishCustomNightSnapshot } from "#src/customs/socket.ts";
import { prisma, type Db } from "#src/database/index.ts";

export async function gameContext(
  claims: CustomActivityClaims,
  input: CustomRevisionInput,
  manager: boolean,
): Promise<{ actor: CustomActivityActor; snapshot: CustomNightSnapshot }> {
  return customMutationContext(claims, input, manager);
}

export function currentGame(snapshot: CustomNightSnapshot) {
  if (snapshot.currentGame === null) {
    throw new Error("There is no current custom game");
  }
  return snapshot.currentGame;
}

export async function afterGameMutation(
  nightId: string,
  actor: CustomActivityActor,
): Promise<CustomNightSnapshot> {
  await publishCustomNightSnapshot(nightId);
  return requiredCustomSnapshot(
    prisma,
    nightId,
    actor,
    "Custom night disappeared after mutation",
  );
}

export async function writeGameParticipants(
  transaction: Db,
  gameId: string,
  participants: readonly CustomGameParticipant[],
): Promise<void> {
  for (const participant of participants) {
    await transaction.customGameParticipant.update({
      where: {
        gameId_discordId: { gameId, discordId: participant.discordId },
      },
      data: {
        team: participant.team,
        side: participant.side,
        captain: participant.captain,
        pickOrder: participant.pickOrder,
      },
    });
  }
}

export function customGameParticipantWrite(participant: CustomGameParticipant) {
  return {
    ...participant,
    discordId: DiscordAccountIdSchema.parse(participant.discordId),
    playerId: PlayerIdSchema.parse(participant.playerId),
    accountId: AccountIdSchema.parse(participant.accountId),
    puuid: LeaguePuuidSchema.parse(participant.puuid),
  };
}
