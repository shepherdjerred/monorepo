import {
  AccountIdSchema,
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  RegionSchema,
  type CustomActivityClaims,
  type CustomNightSnapshot,
  type CustomTeam,
  type DiscordAccountId,
} from "@scout-for-lol/data";
import { tournamentApiMode } from "#src/config/dynamic.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { type CustomActivityActor } from "#src/customs/activity-actor.ts";
import {
  assertCustomTeamsComplete,
  assertRosterLockable,
  snapshotCustomParticipant,
} from "#src/customs/draft.ts";
import type { CustomRevisionInput as RevisionInput } from "#src/customs/activity-mutation-context.ts";
import {
  afterGameMutation,
  currentGame,
  customGameParticipantWrite,
  gameContext,
} from "#src/customs/game-context.ts";
import { commitCustomMutation } from "#src/customs/repository.ts";
import { buildCustomNightSnapshot } from "#src/customs/snapshot.ts";
import { returnCustomVoiceToLobby } from "#src/customs/voice-service.ts";
import { prisma } from "#src/database/index.ts";
import { provisionTournamentLobby } from "#src/league/tournament/provision-lobby.ts";

async function resolvedSides(game: ReturnType<typeof currentGame>) {
  assertCustomTeamsComplete(game.participants);
  const accountIds = game.participants.map((participant) =>
    AccountIdSchema.parse(participant.accountId),
  );
  const accounts = await prisma.account.findMany({
    where: { id: { in: accountIds } },
  });
  const regions = new Map(
    accounts.map((account) => [account.id, RegionSchema.parse(account.region)]),
  );
  const side = (team: CustomTeam) => {
    const participants = game.participants.filter(
      (participant) => participant.team === team,
    );
    const firstParticipant = participants[0];
    if (firstParticipant === undefined) {
      throw new Error(`Team ${team} has no participants`);
    }
    const firstRegion = regions.get(
      AccountIdSchema.parse(firstParticipant.accountId),
    );
    if (firstRegion === undefined) {
      throw new Error(`Team ${team} has an unknown Riot account`);
    }
    for (const participant of participants) {
      if (
        regions.get(AccountIdSchema.parse(participant.accountId)) !==
        firstRegion
      ) {
        throw new Error("Tournament lobby players must use one Riot region");
      }
    }
    return {
      aliases: participants.map((participant) => participant.playerAlias),
      puuids: participants.map((participant) => participant.puuid),
      region: firstRegion,
    };
  };
  return { blue: side("A"), red: side("B") };
}

async function provisionCustomCode(
  actor: CustomActivityActor,
  snapshot: CustomNightSnapshot,
): Promise<CustomNightSnapshot> {
  const game = currentGame(snapshot);
  if (
    !(await isPolicyEnabled("tournament_lobbies_enabled", {
      server: actor.guildId,
    }))
  ) {
    throw new Error("Tournament lobbies are not enabled in this guild");
  }
  const sides = await resolvedSides(game);
  const lobby = await provisionTournamentLobby(prisma, {
    kind: "declared",
    requestId: `customs:${game.id}`,
    mode: tournamentApiMode(),
    serverId: DiscordGuildIdSchema.parse(snapshot.guildId),
    channelId: DiscordChannelIdSchema.parse(snapshot.launchChannelId),
    creatorDiscordId: DiscordAccountIdSchema.parse(snapshot.hostDiscordId),
    blue: sides.blue,
    red: sides.red,
    pickType: game.pickMode,
    mapType: game.map,
    spectatorType: "ALL",
    lobbyName: `${snapshot.guildName} Customs #${game.sequence.toString()}`,
  });
  await commitCustomMutation(
    prisma,
    {
      nightId: snapshot.id,
      expectedRevision: snapshot.revision,
      actorId: actor.discordId,
      action: "TOURNAMENT_LOBBY_LINKED",
      payload: { tournamentLobbyId: lobby.id },
      source: "ACTIVITY",
      now: new Date(),
      gameId: game.id,
    },
    async (transaction) => {
      await transaction.customGame.update({
        where: { id: game.id },
        data: { tournamentLobbyId: lobby.id, state: "LOBBY_READY" },
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
  return provisionCustomCode(actor, pending);
}

export async function retryCustomCode(
  claims: CustomActivityClaims,
  input: RevisionInput,
): Promise<CustomNightSnapshot> {
  const { actor, snapshot } = await gameContext(claims, input, true);
  if (currentGame(snapshot).state !== "CODE_PENDING") {
    throw new Error("The game is not waiting for a tournament code");
  }
  return provisionCustomCode(actor, snapshot);
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
