import type { CustomNightParticipant } from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { hasCustomHostControl } from "#src/customs/authorization.ts";
import {
  commitCustomMutation,
  type CustomMutationResult,
} from "#src/customs/repository.ts";
import { refreshSnapshot } from "#src/customs/snapshot.ts";
import type { CustomActor } from "#src/customs/service.ts";

export async function selectCustomAccount(params: {
  prisma: ExtendedPrismaClient;
  actor: CustomActor;
  nightId: string;
  expectedRevision: number;
  accountId: number;
  targetDiscordId?: string | undefined;
  now?: Date;
}): Promise<CustomMutationResult> {
  const target = params.targetDiscordId ?? params.actor.discordId;
  const now = params.now ?? new Date();
  return await commitCustomMutation({
    ...params,
    actorDiscordId: params.actor.discordId,
    action: "ACCOUNT_SELECTED",
    payload: { targetDiscordId: target, accountId: params.accountId },
    update: (snapshot) => {
      if (
        target !== params.actor.discordId &&
        !hasCustomHostControl(
          snapshot,
          params.actor.discordId,
          params.actor.discordAdministrator,
        )
      ) {
        throw new Error(
          "Only host control may correct another player's account",
        );
      }
      const participant = snapshot.participants.find(
        (candidate) => candidate.discordId === target,
      );
      if (participant === undefined)
        throw new Error("The selected player has not joined this night");
      const selectedParticipant: CustomNightParticipant = {
        ...participant,
        selectedAccountId: params.accountId,
      };
      const participants = snapshot.participants.map((candidate) =>
        candidate.discordId === target ? selectedParticipant : candidate,
      );
      const selectedAccount = selectedParticipant.accounts.find(
        (account) => account.accountId === params.accountId,
      );
      if (selectedAccount === undefined)
        throw new Error("The selected account does not belong to this player");
      const rostered = snapshot.currentGame?.participants.some(
        (gameParticipant) => gameParticipant.discordId === target,
      );
      if (
        rostered === true &&
        snapshot.currentGame !== null &&
        snapshot.currentGame.state !== "ROSTER_OPEN" &&
        snapshot.currentGame.state !== "CAPTAINS_SET" &&
        snapshot.currentGame.state !== "DRAFTING"
      ) {
        throw new Error("A rostered account cannot change after teams lock");
      }
      const playerId = selectedParticipant.playerId;
      const playerAlias = selectedParticipant.playerAlias;
      let currentGame = snapshot.currentGame;
      if (rostered === true) {
        if (currentGame === null)
          throw new Error("Rostered player has no current game");
        if (playerId === null || playerAlias === null)
          throw new Error("The selected player needs a Scout player mapping");
        currentGame = {
          ...currentGame,
          participants: currentGame.participants.map((gameParticipant) =>
            gameParticipant.discordId === target
              ? {
                  ...gameParticipant,
                  displayName: selectedParticipant.displayName,
                  playerId,
                  playerAlias,
                  accountId: selectedAccount.accountId,
                  puuid: selectedAccount.puuid,
                  riotGameName: selectedAccount.riotGameName,
                  riotTagLine: selectedAccount.riotTagLine,
                }
              : gameParticipant,
          ),
        };
      }
      return refreshSnapshot({ ...snapshot, participants, currentGame }, now);
    },
  });
}
