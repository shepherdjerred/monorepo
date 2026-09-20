import {
  type CustomActivityClaims,
  type CustomNightSnapshot,
  type DiscordAccountId,
} from "@scout-for-lol/data";
import { type CustomActivityActor } from "#src/customs/activity/activity-actor.ts";
import {
  assertCustomTeamsComplete,
  assertRosterLockable,
  snapshotCustomParticipant,
} from "#src/customs/game/draft.ts";
import type { CustomRevisionInput as RevisionInput } from "#src/customs/activity/activity-mutation-context.ts";
import {
  afterGameMutation,
  currentGame,
  customGameParticipantWrite,
  gameContext,
} from "#src/customs/game/game-context.ts";
import { commitCustomMutation } from "#src/customs/repository.ts";
import { buildCustomNightSnapshot } from "#src/customs/snapshot.ts";
import { returnCustomVoiceToLobby } from "#src/customs/voice-service.ts";
import { prisma } from "#src/database/index.ts";

async function openObservedCustomLobby(
  actor: CustomActivityActor,
  snapshot: CustomNightSnapshot,
): Promise<CustomNightSnapshot> {
  const game = currentGame(snapshot);
  assertCustomTeamsComplete(game.participants);
  await commitCustomMutation(
    prisma,
    {
      nightId: snapshot.id,
      expectedRevision: snapshot.revision,
      actorId: actor.discordId,
      action: "LOCAL_LOBBY_REQUESTED",
      payload: {},
      source: "ACTIVITY",
      now: new Date(),
      gameId: game.id,
    },
    async (transaction) => {
      await transaction.customGame.update({
        where: { id: game.id },
        data: { state: "LOBBY_READY", tournamentLobbyId: null },
      });
      await transaction.customNight.update({
        where: { id: snapshot.id },
        data: { state: "LOBBY_READY" },
      });
    },
  );
  return afterGameMutation(snapshot.id, actor);
}

export async function lockCustomTeams(
  claims: CustomActivityClaims,
  input: RevisionInput,
): Promise<CustomNightSnapshot> {
  const { actor, snapshot } = await gameContext(claims, input, true);
  const game = currentGame(snapshot);
  if (!["CAPTAINS_SET", "DRAFTING"].includes(game.state)) {
    throw new Error("Teams cannot be locked in the current game state");
  }
  assertCustomTeamsComplete(game.participants);
  await commitCustomMutation(
    prisma,
    {
      ...input,
      actorId: actor.discordId,
      action: "TEAMS_LOCKED",
      payload: {},
      source: "ACTIVITY",
      now: new Date(),
      gameId: game.id,
    },
    async (transaction) => {
      await transaction.customGame.update({
        where: { id: game.id },
        data: { state: "CODE_PENDING", activeCaptain: null },
      });
    },
  );
  const pending = await buildCustomNightSnapshot(
    prisma,
    input.nightId,
    actor.discordId,
    { viewerAdministrator: actor.administrator },
  );
  if (pending === undefined) {
    throw new Error("Custom night disappeared before lobby provisioning");
  }
  return openObservedCustomLobby(actor, pending);
}

export async function retryCustomCode(
  claims: CustomActivityClaims,
  input: RevisionInput,
): Promise<CustomNightSnapshot> {
  const { actor, snapshot } = await gameContext(claims, input, true);
  if (currentGame(snapshot).state !== "CODE_PENDING") {
    throw new Error("The game is not waiting for a custom lobby");
  }
  return openObservedCustomLobby(actor, snapshot);
}

export async function substituteCustomParticipant(
  claims: CustomActivityClaims,
  input: RevisionInput & {
    outgoingDiscordId: DiscordAccountId;
    incomingDiscordId: DiscordAccountId;
  },
): Promise<CustomNightSnapshot> {
  const { actor, snapshot } = await gameContext(claims, input, true);
  const game = currentGame(snapshot);
  if (
    [
      "CODE_PENDING",
      "LOBBY_READY",
      "PLAYING",
      "RESULT_PENDING",
      "VERIFIED",
      "VOID",
    ].includes(game.state)
  ) {
    throw new Error("The roster is locked for this custom game");
  }
  const outgoing = game.participants.find(
    (participant) => participant.discordId === input.outgoingDiscordId,
  );
  const incoming = snapshot.participants.find(
    (participant) => participant.discordId === input.incomingDiscordId,
  );
  if (outgoing === undefined || incoming === undefined) {
    throw new Error("Substitution participants are not available");
  }
  assertRosterLockable(
    [
      incoming,
      ...snapshot.participants.filter((candidate) =>
        game.participants.some(
          (participant) =>
            participant.discordId === candidate.discordId &&
            participant.discordId !== outgoing.discordId,
        ),
      ),
    ].slice(0, 10),
  );
  const replacement = snapshotCustomParticipant(incoming, outgoing.rosterOrder);
  await commitCustomMutation(
    prisma,
    {
      ...input,
      actorId: actor.discordId,
      action: "PLAYER_SUBSTITUTED",
      payload: {
        outgoingDiscordId: outgoing.discordId,
        incomingDiscordId: replacement.discordId,
      },
      source: "ACTIVITY",
      now: new Date(),
      gameId: game.id,
    },
    async (transaction) => {
      await transaction.customGameParticipant.delete({
        where: {
          gameId_discordId: { gameId: game.id, discordId: outgoing.discordId },
        },
      });
      await transaction.customGameParticipant.create({
        data: {
          gameId: game.id,
          ...customGameParticipantWrite(replacement),
          team: outgoing.team,
          side: outgoing.side,
          captain: outgoing.captain,
          pickOrder: outgoing.pickOrder,
        },
      });
    },
  );
  return afterGameMutation(input.nightId, actor);
}

export async function setCustomVoiceOverride(
  claims: CustomActivityClaims,
  input: RevisionInput & { enabled: boolean },
): Promise<CustomNightSnapshot> {
  const { actor, snapshot } = await gameContext(claims, input, true);
  const game = currentGame(snapshot);
  await commitCustomMutation(
    prisma,
    {
      ...input,
      actorId: actor.discordId,
      action: "VOICE_OVERRIDE_SET",
      payload: { enabled: input.enabled },
      source: "ACTIVITY",
      now: new Date(),
      gameId: game.id,
    },
    async (transaction) => {
      await transaction.customGame.update({
        where: { id: game.id },
        data: { voiceOverride: input.enabled },
      });
    },
  );
  return afterGameMutation(input.nightId, actor);
}

export async function voidCustomGame(
  claims: CustomActivityClaims,
  input: RevisionInput & { reason: string },
): Promise<CustomNightSnapshot> {
  let { actor, snapshot } = await gameContext(claims, input, true);
  if (
    snapshot.teamAVoiceChannelId !== null ||
    snapshot.teamBVoiceChannelId !== null
  ) {
    snapshot = await returnCustomVoiceToLobby(claims, {
      nightId: input.nightId,
      expectedRevision: snapshot.revision,
    });
    ({ actor, snapshot } = await gameContext(
      claims,
      { nightId: input.nightId, expectedRevision: snapshot.revision },
      true,
    ));
  }
  const game = currentGame(snapshot);
  if (game.state === "VERIFIED" || game.state === "VOID") {
    throw new Error("The current custom game is already terminal");
  }
  await commitCustomMutation(
    prisma,
    {
      nightId: input.nightId,
      expectedRevision: snapshot.revision,
      actorId: actor.discordId,
      action: "GAME_VOIDED",
      payload: { reason: input.reason },
      source: "ACTIVITY",
      now: new Date(),
      gameId: game.id,
    },
    async (transaction) => {
      await transaction.customGame.update({
        where: { id: game.id },
        data: { state: "VOID", completedAt: new Date() },
      });
      await transaction.tournamentLobby.updateMany({
        where: {
          customGame: { id: game.id },
          state: { notIn: ["reported", "cancelled", "abandoned", "expired"] },
        },
        data: { state: "cancelled" },
      });
      await transaction.customNight.update({
        where: { id: input.nightId },
        data: { state: "INTERMISSION" },
      });
    },
  );
  return afterGameMutation(input.nightId, actor);
}
