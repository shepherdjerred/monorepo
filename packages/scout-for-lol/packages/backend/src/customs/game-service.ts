import {
  CustomGameSnapshotSchema,
  type CustomMap,
  type CustomNightSnapshot,
  type CustomPickMode,
  type CustomRosterMode,
  type CustomWinner,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import {
  assertActiveCaptain,
  assertCustomHostControl,
} from "#src/customs/authorization.ts";
import {
  activeDraftTeam,
  assertCustomTeamsComplete,
  assertRosterLockable,
  pickCustomPlayer,
  selectCaptains,
  selectCustomRoster,
  snapshotRoster,
  undoCustomPick,
} from "#src/customs/draft.ts";
import { transitionCustomGame } from "#src/customs/game-machine.ts";
import { transitionCustomNight } from "#src/customs/night-machine.ts";
import {
  commitCustomMutation,
  getCustomNight,
  type CustomMutationResult,
} from "#src/customs/repository.ts";
import { refreshSnapshot } from "#src/customs/snapshot.ts";
import { refreshCustomParticipantMappings } from "#src/customs/participant-mapping.ts";
import type { CustomActor } from "#src/customs/service.ts";

function currentGame(snapshot: CustomNightSnapshot) {
  if (snapshot.currentGame === null)
    throw new Error("There is no current custom game");
  return snapshot.currentGame;
}

export async function prepareCustomGame(params: {
  prisma: ExtendedPrismaClient;
  actor: CustomActor;
  nightId: string;
  expectedRevision: number;
  rosterMode: CustomRosterMode;
  selectedDiscordIds: readonly string[];
  map: CustomMap;
  pickMode: CustomPickMode;
  now?: Date;
}): Promise<CustomMutationResult> {
  const original = await getCustomNight(params.prisma, params.nightId);
  if (original === null) throw new Error("Custom night not found");
  assertCustomHostControl(
    original,
    params.actor.discordId,
    params.actor.discordAdministrator,
  );
  const participants = await refreshCustomParticipantMappings({
    prisma: params.prisma,
    snapshot: original,
  });
  const roster = selectCustomRoster({
    participants,
    mode: params.rosterMode,
    selectedDiscordIds: params.selectedDiscordIds,
  });
  const now = params.now ?? new Date();
  return await commitCustomMutation({
    ...params,
    actorDiscordId: params.actor.discordId,
    action: "GAME_PREPARED",
    payload: {
      rosterMode: params.rosterMode,
      selectedDiscordIds: params.selectedDiscordIds,
      rosterDiscordIds: roster.map((participant) => participant.discordId),
      map: params.map,
      pickMode: params.pickMode,
    },
    update: (snapshot) => {
      assertCustomHostControl(
        snapshot,
        params.actor.discordId,
        params.actor.discordAdministrator,
      );
      const state =
        snapshot.state === "RECRUITING"
          ? transitionCustomNight(snapshot.state, { type: "START_PREPARING" })
          : transitionCustomNight(snapshot.state, {
              type: "PREPARE_NEXT_GAME",
            });
      const currentGameSnapshot = CustomGameSnapshotSchema.parse({
        id: globalThis.crypto.randomUUID(),
        sequence: (snapshot.currentGame?.sequence ?? 0) + 1,
        state: "ROSTER_OPEN",
        rosterMode: params.rosterMode,
        map: params.map,
        pickMode: params.pickMode,
        participants: snapshotRoster(roster),
        activeCaptain: null,
        tournamentCode: null,
        riotMatchId: null,
        winner: null,
        resultSource: null,
        resultDisagreement: false,
        repeatChampionWarnings: [],
        voiceReady: false,
        voiceOverride: false,
        voiceError: null,
        createdAt: now.toISOString(),
        startedAt: null,
        completedAt: null,
      });
      return refreshSnapshot(
        { ...snapshot, state, participants, currentGame: currentGameSnapshot },
        now,
      );
    },
  });
}

export async function selectCustomCaptains(params: {
  prisma: ExtendedPrismaClient;
  actor: CustomActor;
  nightId: string;
  expectedRevision: number;
  now?: Date;
}): Promise<CustomMutationResult> {
  const original = await getCustomNight(params.prisma, params.nightId);
  if (original === null) throw new Error("Custom night not found");
  assertCustomHostControl(
    original,
    params.actor.discordId,
    params.actor.discordAdministrator,
  );
  const originalGame = currentGame(original);
  const roster = originalGame.participants.map((gameParticipant) => {
    const participant = original.participants.find(
      (candidate) => candidate.discordId === gameParticipant.discordId,
    );
    if (participant === undefined)
      throw new Error("Roster participant left the night");
    return participant;
  });
  assertRosterLockable(roster);
  const participants = selectCaptains(originalGame.participants);
  const now = params.now ?? new Date();
  return await commitCustomMutation({
    ...params,
    actorDiscordId: params.actor.discordId,
    action: "CAPTAINS_RANDOMIZED",
    payload: {
      captains: participants
        .filter((participant) => participant.captain)
        .map((participant) => ({
          discordId: participant.discordId,
          team: participant.team,
          side: participant.side,
        })),
    },
    update: (snapshot) => {
      assertCustomHostControl(
        snapshot,
        params.actor.discordId,
        params.actor.discordAdministrator,
      );
      const game = currentGame(snapshot);
      if (game.id !== originalGame.id)
        throw new Error("Custom game changed during captain selection");
      const gameState = transitionCustomGame(game.state, {
        type: "CAPTAINS_SELECTED",
      });
      const draftingState = transitionCustomGame(gameState, {
        type: "START_DRAFT",
      });
      const state = transitionCustomNight(snapshot.state, {
        type: "START_DRAFT",
      });
      return refreshSnapshot(
        {
          ...snapshot,
          state,
          currentGame: {
            ...game,
            state: draftingState,
            participants,
            activeCaptain: activeDraftTeam(participants),
          },
        },
        now,
      );
    },
  });
}

export async function makeCustomPick(params: {
  prisma: ExtendedPrismaClient;
  actor: CustomActor;
  nightId: string;
  expectedRevision: number;
  discordId: string;
  now?: Date;
}): Promise<CustomMutationResult> {
  const now = params.now ?? new Date();
  return await commitCustomMutation({
    ...params,
    actorDiscordId: params.actor.discordId,
    action: "PLAYER_DRAFTED",
    payload: { discordId: params.discordId },
    update: (snapshot) => {
      assertActiveCaptain(snapshot, params.actor.discordId);
      const game = currentGame(snapshot);
      const participants = pickCustomPlayer({
        participants: game.participants,
        captainDiscordId: params.actor.discordId,
        pickedDiscordId: params.discordId,
      });
      return refreshSnapshot(
        {
          ...snapshot,
          currentGame: {
            ...game,
            participants,
            activeCaptain: activeDraftTeam(participants),
          },
        },
        now,
      );
    },
  });
}

export async function undoCustomDraftPick(params: {
  prisma: ExtendedPrismaClient;
  actor: CustomActor;
  nightId: string;
  expectedRevision: number;
  now?: Date;
}): Promise<CustomMutationResult> {
  const now = params.now ?? new Date();
  return await commitCustomMutation({
    ...params,
    actorDiscordId: params.actor.discordId,
    action: "DRAFT_PICK_UNDONE",
    payload: {},
    update: (snapshot) => {
      assertCustomHostControl(
        snapshot,
        params.actor.discordId,
        params.actor.discordAdministrator,
      );
      const game = currentGame(snapshot);
      if (game.state !== "DRAFTING")
        throw new Error("Cannot undo a draft pick outside the drafting phase");
      const participants = undoCustomPick(game.participants);
      return refreshSnapshot(
        {
          ...snapshot,
          currentGame: {
            ...game,
            participants,
            activeCaptain: activeDraftTeam(participants),
          },
        },
        now,
      );
    },
  });
}

export async function lockCustomTeams(params: {
  prisma: ExtendedPrismaClient;
  actor: CustomActor;
  nightId: string;
  expectedRevision: number;
  now?: Date;
}): Promise<CustomMutationResult> {
  const now = params.now ?? new Date();
  return await commitCustomMutation({
    ...params,
    actorDiscordId: params.actor.discordId,
    action: "TEAMS_LOCKED",
    payload: {},
    update: (snapshot) => {
      assertCustomHostControl(
        snapshot,
        params.actor.discordId,
        params.actor.discordAdministrator,
      );
      const game = currentGame(snapshot);
      assertCustomTeamsComplete(game.participants);
      const roster = game.participants.map((gameParticipant) => {
        const participant = snapshot.participants.find(
          (candidate) => candidate.discordId === gameParticipant.discordId,
        );
        if (participant === undefined)
          throw new Error("Roster participant left the night");
        return participant;
      });
      assertRosterLockable(roster);
      return refreshSnapshot(
        {
          ...snapshot,
          state: transitionCustomNight(snapshot.state, {
            type: "TEAMS_LOCKED",
          }),
          currentGame: {
            ...game,
            state: transitionCustomGame(game.state, { type: "TEAMS_LOCKED" }),
          },
        },
        now,
      );
    },
  });
}

export async function recordCustomManualResult(params: {
  prisma: ExtendedPrismaClient;
  actor: CustomActor;
  nightId: string;
  expectedRevision: number;
  winner: CustomWinner;
  now?: Date;
}): Promise<CustomMutationResult> {
  const now = params.now ?? new Date();
  return await commitCustomMutation({
    ...params,
    actorDiscordId: params.actor.discordId,
    action: "MANUAL_RESULT_RECORDED",
    payload: { winner: params.winner },
    update: (snapshot) => {
      assertCustomHostControl(
        snapshot,
        params.actor.discordId,
        params.actor.discordAdministrator,
      );
      const game = currentGame(snapshot);
      const pending =
        game.state === "PLAYING"
          ? transitionCustomGame(game.state, { type: "AWAIT_RESULT" })
          : game.state;
      const state =
        snapshot.state === "PLAYING"
          ? transitionCustomNight(snapshot.state, {
              type: "INTERMISSION_OPENED",
            })
          : snapshot.state;
      return refreshSnapshot(
        {
          ...snapshot,
          state,
          currentGame: {
            ...game,
            state: transitionCustomGame(pending, { type: "MANUAL_RESULT" }),
            winner: params.winner,
            resultSource: "MANUAL",
            completedAt: now.toISOString(),
          },
        },
        now,
      );
    },
  });
}
