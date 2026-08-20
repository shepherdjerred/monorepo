import type {
  CustomGameParticipant,
  CustomNightParticipant,
  CustomNightSnapshot,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { assertCustomHostControl } from "#src/customs/authorization.ts";
import {
  assertRosterLockable,
  selectCaptains,
  snapshotCustomParticipant,
} from "#src/customs/draft.ts";
import { refreshCustomParticipantMappings } from "#src/customs/participant-mapping.ts";
import {
  commitCustomMutation,
  getCustomNight,
  type CustomMutationResult,
} from "#src/customs/repository.ts";
import { refreshSnapshot } from "#src/customs/snapshot.ts";
import type { CustomActor } from "#src/customs/service.ts";

function currentGame(snapshot: CustomNightSnapshot) {
  if (snapshot.currentGame === null)
    throw new Error("There is no current custom game");
  return snapshot.currentGame;
}

function nightRoster(
  snapshot: CustomNightSnapshot,
  participants: readonly CustomGameParticipant[],
): CustomNightParticipant[] {
  return participants.map((gameParticipant) => {
    const participant = snapshot.participants.find(
      (candidate) => candidate.discordId === gameParticipant.discordId,
    );
    if (participant === undefined)
      throw new Error("Roster participant is no longer in the night");
    return participant;
  });
}

function captainPayload(participants: readonly CustomGameParticipant[]) {
  return participants
    .filter((participant) => participant.captain)
    .map((participant) => ({
      discordId: participant.discordId,
      team: participant.team,
      side: participant.side,
    }));
}

export async function rerollCustomCaptains(params: {
  prisma: ExtendedPrismaClient;
  actor: CustomActor;
  nightId: string;
  expectedRevision: number;
  now?: Date;
}): Promise<CustomMutationResult> {
  const original = await getCustomNight(params.prisma, params.nightId);
  if (original === null) throw new Error("Custom night not found");
  const originalGame = currentGame(original);
  if (
    originalGame.state !== "DRAFTING" ||
    originalGame.participants.some(
      (participant) => participant.pickOrder !== null,
    )
  ) {
    throw new Error("Captains may be rerolled only before the first pick");
  }
  const reset = originalGame.participants.map((participant) => ({
    ...participant,
    captain: false,
    team: null,
    side: null,
  }));
  const participants = selectCaptains(reset);
  const now = params.now ?? new Date();
  return await commitCustomMutation({
    ...params,
    actorDiscordId: params.actor.discordId,
    action: "CAPTAINS_REROLLED",
    payload: { captains: captainPayload(participants) },
    update: (snapshot) => {
      assertCustomHostControl(
        snapshot,
        params.actor.discordId,
        params.actor.discordAdministrator,
      );
      const game = currentGame(snapshot);
      if (
        game.id !== originalGame.id ||
        game.participants.some((participant) => participant.pickOrder !== null)
      ) {
        throw new Error("Draft changed while captains were rerolled");
      }
      return refreshSnapshot(
        {
          ...snapshot,
          currentGame: { ...game, participants, activeCaptain: "A" },
        },
        now,
      );
    },
  });
}

export async function substituteCustomPlayer(params: {
  prisma: ExtendedPrismaClient;
  actor: CustomActor;
  nightId: string;
  expectedRevision: number;
  outgoingDiscordId: string;
  incomingDiscordId: string;
  now?: Date;
}): Promise<CustomMutationResult> {
  const now = params.now ?? new Date();
  const original = await getCustomNight(params.prisma, params.nightId);
  if (original === null) throw new Error("Custom night not found");
  const refreshedParticipants = await refreshCustomParticipantMappings({
    prisma: params.prisma,
    snapshot: original,
  });
  return await commitCustomMutation({
    ...params,
    actorDiscordId: params.actor.discordId,
    action: "ROSTER_PLAYER_SUBSTITUTED",
    payload: {
      outgoingDiscordId: params.outgoingDiscordId,
      incomingDiscordId: params.incomingDiscordId,
    },
    update: (snapshot) => {
      assertCustomHostControl(
        snapshot,
        params.actor.discordId,
        params.actor.discordAdministrator,
      );
      const game = currentGame(snapshot);
      if (
        game.state !== "ROSTER_OPEN" &&
        game.state !== "CAPTAINS_SET" &&
        game.state !== "DRAFTING"
      ) {
        throw new Error("The roster is already locked");
      }
      if (
        game.participants.some((participant) => participant.pickOrder !== null)
      )
        throw new Error("Undo all draft picks before substituting a player");
      if (
        game.participants.some(
          (participant) => participant.discordId === params.incomingDiscordId,
        )
      ) {
        throw new Error("The incoming player is already on the roster");
      }
      const outgoing = game.participants.find(
        (participant) => participant.discordId === params.outgoingDiscordId,
      );
      const incoming = snapshot.participants.find(
        (participant) => participant.discordId === params.incomingDiscordId,
      );
      const refreshedIncoming = refreshedParticipants.find(
        (participant) => participant.discordId === params.incomingDiscordId,
      );
      if (outgoing === undefined || incoming === undefined)
        throw new Error("Both substitution players must belong to this night");
      if (refreshedIncoming === undefined)
        throw new Error("The incoming player is no longer in this night");
      const participants = snapshot.participants.map((participant) =>
        participant.discordId === refreshedIncoming.discordId
          ? refreshedIncoming
          : participant,
      );
      const replacement = {
        ...snapshotCustomParticipant(refreshedIncoming, outgoing.rosterOrder),
        team: outgoing.team,
        side: outgoing.side,
        captain: outgoing.captain,
      };
      const gameParticipants = game.participants.map((participant) =>
        participant.discordId === outgoing.discordId
          ? replacement
          : participant,
      );
      assertRosterLockable(
        nightRoster({ ...snapshot, participants }, gameParticipants),
      );
      return refreshSnapshot(
        {
          ...snapshot,
          participants,
          currentGame: { ...game, participants: gameParticipants },
        },
        now,
      );
    },
  });
}
