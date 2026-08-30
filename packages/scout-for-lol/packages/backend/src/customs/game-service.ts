import {
  type CustomActivityClaims,
  type CustomGameParticipant,
  type CustomMap,
  type CustomNightSnapshot,
  type CustomPickMode,
  type CustomRosterMode,
  type CustomTeam,
  type DiscordAccountId,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import {
  activeDraftTeam,
  assertRosterLockable,
  pickCustomPlayer,
  randomizeCustomTeams,
  selectCaptains,
  selectCustomRoster,
  selectHostCaptains,
  snapshotRoster,
  undoCustomPick,
} from "#src/customs/draft.ts";
import { canDraftForTeam, customRoleFor } from "#src/customs/authorization.ts";
import type { CustomRevisionInput as RevisionInput } from "#src/customs/activity-mutation-context.ts";
import {
  afterGameMutation,
  currentGame,
  customGameParticipantWrite,
  gameContext,
  writeGameParticipants,
} from "#src/customs/game-context.ts";
import { commitCustomMutation } from "#src/customs/repository.ts";

export async function prepareCustomGame(
  claims: CustomActivityClaims,
  input: RevisionInput & {
    rosterMode: CustomRosterMode;
    selectedDiscordIds: DiscordAccountId[];
    map: CustomMap;
    pickMode: CustomPickMode;
  },
): Promise<CustomNightSnapshot> {
  const { actor, snapshot } = await gameContext(claims, input, true);
  if (snapshot.state !== "PREPARING" && snapshot.state !== "INTERMISSION") {
    throw new Error("The custom night is not ready to prepare a roster");
  }
  if (
    snapshot.currentGame !== null &&
    !["VERIFIED", "VOID"].includes(snapshot.currentGame.state)
  ) {
    throw new Error(
      "The current custom game must finish before preparing another",
    );
  }
  const roster = selectCustomRoster({
    participants: snapshot.participants,
    mode: input.rosterMode,
    selectedDiscordIds: input.selectedDiscordIds,
  });
  assertRosterLockable(roster);
  const participants = snapshotRoster(roster);
  const sequence =
    snapshot.currentGame === null ? 1 : snapshot.currentGame.sequence + 1;
  const gameId = globalThis.crypto.randomUUID();
  await commitCustomMutation(
    prisma,
    {
      ...input,
      actorId: actor.discordId,
      action: "GAME_ROSTER_PREPARED",
      payload: {
        gameId,
        sequence,
        rosterMode: input.rosterMode,
        rosterDiscordIds: participants.map(
          (participant) => participant.discordId,
        ),
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
          state: "ROSTER_OPEN",
          rosterMode: input.rosterMode,
          map: input.map,
          pickMode: input.pickMode,
          participants: {
            create: participants.map((participant) =>
              customGameParticipantWrite(participant),
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
  return afterGameMutation(input.nightId, actor);
}

type CaptainInput = RevisionInput & {
  captainADiscordId?: DiscordAccountId | undefined;
  captainBDiscordId?: DiscordAccountId | undefined;
};

export async function chooseCustomCaptains(
  claims: CustomActivityClaims,
  input: CaptainInput,
): Promise<CustomNightSnapshot> {
  const { actor, snapshot } = await gameContext(claims, input, true);
  const game = currentGame(snapshot);
  if (game.state !== "ROSTER_OPEN" && game.state !== "CAPTAINS_SET") {
    throw new Error("Captains cannot be changed in the current game state");
  }
  const hostSelected =
    input.captainADiscordId !== undefined ||
    input.captainBDiscordId !== undefined;
  if (
    hostSelected &&
    (input.captainADiscordId === undefined ||
      input.captainBDiscordId === undefined)
  ) {
    throw new Error("Host-selected captains require both team captains");
  }
  const participants: CustomGameParticipant[] =
    hostSelected &&
    input.captainADiscordId !== undefined &&
    input.captainBDiscordId !== undefined
      ? selectHostCaptains(
          game.participants,
          input.captainADiscordId,
          input.captainBDiscordId,
        )
      : selectCaptains(game.participants);
  const selected = participants.filter((participant) => participant.captain);
  await commitCustomMutation(
    prisma,
    {
      ...input,
      actorId: actor.discordId,
      action: "CAPTAINS_SELECTED",
      payload: {
        strategy: hostSelected ? "HOST_SELECTED" : "RANDOM",
        captains: selected.map((participant) => ({
          discordId: participant.discordId,
          team: participant.team,
        })),
      },
      source: "ACTIVITY",
      now: new Date(),
      gameId: game.id,
    },
    async (transaction) => {
      await writeGameParticipants(transaction, game.id, participants);
      await transaction.customGame.update({
        where: { id: game.id },
        data: { state: "CAPTAINS_SET", activeCaptain: null },
      });
    },
  );
  return afterGameMutation(input.nightId, actor);
}

export async function randomizeTeams(
  claims: CustomActivityClaims,
  input: RevisionInput,
): Promise<CustomNightSnapshot> {
  const { actor, snapshot } = await gameContext(claims, input, true);
  const game = currentGame(snapshot);
  if (game.state !== "CAPTAINS_SET")
    throw new Error("Select captains before randomizing teams");
  const participants = randomizeCustomTeams(game.participants);
  await commitCustomMutation(
    prisma,
    {
      ...input,
      actorId: actor.discordId,
      action: "TEAMS_RANDOMIZED",
      payload: {
        assignments: participants.map((participant) => ({
          discordId: participant.discordId,
          team: participant.team,
        })),
      },
      source: "ACTIVITY",
      now: new Date(),
      gameId: game.id,
    },
    async (transaction) =>
      writeGameParticipants(transaction, game.id, participants),
  );
  return afterGameMutation(input.nightId, actor);
}

export async function assignCustomTeam(
  claims: CustomActivityClaims,
  input: RevisionInput & { discordId: DiscordAccountId; team: CustomTeam },
): Promise<CustomNightSnapshot> {
  const { actor, snapshot } = await gameContext(claims, input, true);
  const game = currentGame(snapshot);
  if (!["CAPTAINS_SET", "DRAFTING"].includes(game.state))
    throw new Error("Teams cannot be edited now");
  const participant = game.participants.find(
    (candidate) => candidate.discordId === input.discordId,
  );
  if (participant === undefined)
    throw new Error("Player is not on the current roster");
  if (participant.captain && participant.team !== input.team)
    throw new Error("Captains cannot switch teams");
  const teamCount = game.participants.filter(
    (candidate) =>
      candidate.team === input.team && candidate.discordId !== input.discordId,
  ).length;
  if (teamCount >= 5)
    throw new Error(`Team ${input.team} already has five players`);
  await commitCustomMutation(
    prisma,
    {
      ...input,
      actorId: actor.discordId,
      action: "TEAM_ASSIGNED",
      payload: { discordId: input.discordId, team: input.team },
      source: "ACTIVITY",
      now: new Date(),
      gameId: game.id,
    },
    async (transaction) => {
      await transaction.customGameParticipant.update({
        where: {
          gameId_discordId: { gameId: game.id, discordId: input.discordId },
        },
        data: {
          team: input.team,
          side: input.team === "A" ? "BLUE" : "RED",
          pickOrder: null,
        },
      });
    },
  );
  return afterGameMutation(input.nightId, actor);
}

export async function draftCustomPlayer(
  claims: CustomActivityClaims,
  input: RevisionInput & { discordId: DiscordAccountId },
): Promise<CustomNightSnapshot> {
  const { actor, snapshot } = await gameContext(claims, input, false);
  const game = currentGame(snapshot);
  if (!["CAPTAINS_SET", "DRAFTING"].includes(game.state))
    throw new Error("The game is not drafting");
  const activeTeam = activeDraftTeam(game.participants);
  if (activeTeam === null) throw new Error("The draft is complete");
  const role = customRoleFor(snapshot, actor.discordId, actor.administrator);
  if (!canDraftForTeam(role, actor.discordId, game.participants, activeTeam)) {
    throw new Error(`Only Team ${activeTeam}'s captain may pick`);
  }
  const captain = game.participants.find(
    (participant) => participant.captain && participant.team === activeTeam,
  );
  if (captain === undefined)
    throw new Error(`Team ${activeTeam} has no captain`);
  const participants = pickCustomPlayer({
    participants: game.participants,
    captainDiscordId: captain.discordId,
    pickedDiscordId: input.discordId,
  });
  const nextTeam = activeDraftTeam(participants);
  await commitCustomMutation(
    prisma,
    {
      ...input,
      actorId: actor.discordId,
      action: "DRAFT_PICK_ACCEPTED",
      payload: { discordId: input.discordId, team: activeTeam },
      source: "ACTIVITY",
      now: new Date(),
      gameId: game.id,
    },
    async (transaction) => {
      await writeGameParticipants(transaction, game.id, participants);
      await transaction.customGame.update({
        where: { id: game.id },
        data: { state: "DRAFTING", activeCaptain: nextTeam },
      });
      await transaction.customNight.update({
        where: { id: input.nightId },
        data: { state: "DRAFTING" },
      });
    },
  );
  return afterGameMutation(input.nightId, actor);
}

export async function undoDraftPick(
  claims: CustomActivityClaims,
  input: RevisionInput,
): Promise<CustomNightSnapshot> {
  const { actor, snapshot } = await gameContext(claims, input, true);
  const game = currentGame(snapshot);
  if (game.state !== "DRAFTING") {
    throw new Error("Draft picks can be undone only while drafting");
  }
  const participants = undoCustomPick(game.participants);
  await commitCustomMutation(
    prisma,
    {
      ...input,
      actorId: actor.discordId,
      action: "DRAFT_PICK_UNDONE",
      payload: {},
      source: "ACTIVITY",
      now: new Date(),
      gameId: game.id,
    },
    async (transaction) => {
      await writeGameParticipants(transaction, game.id, participants);
      await transaction.customGame.update({
        where: { id: game.id },
        data: { activeCaptain: activeDraftTeam(participants) },
      });
    },
  );
  return afterGameMutation(input.nightId, actor);
}
