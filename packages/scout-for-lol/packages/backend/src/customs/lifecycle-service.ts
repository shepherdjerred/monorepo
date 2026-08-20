import {
  CustomGameSnapshotSchema,
  type CustomGameParticipant,
  type CustomIntermissionChoice,
  type CustomNightSnapshot,
  type CustomTeam,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { assertCustomHostControl } from "#src/customs/authorization.ts";
import {
  assertRosterLockable,
  rerollCaptainsWithinTeams,
  selectCaptainsExcludingPrevious,
} from "#src/customs/draft.ts";
import { transitionCustomGame } from "#src/customs/game-machine.ts";
import { transitionCustomNight } from "#src/customs/night-machine.ts";
import {
  commitCustomMutation,
  getCustomNight,
  type CustomMutationResult,
} from "#src/customs/repository.ts";
import {
  hasActiveVoiceArrangementProvisioning,
  refreshSnapshot,
} from "#src/customs/snapshot.ts";
import type { CustomActor } from "#src/customs/service.ts";

function currentGame(snapshot: CustomNightSnapshot) {
  if (snapshot.currentGame === null)
    throw new Error("There is no current custom game");
  return snapshot.currentGame;
}

function captainIds(
  participants: readonly CustomGameParticipant[],
): Record<CustomTeam, string> {
  const captainA = participants.find(
    (participant) => participant.captain && participant.team === "A",
  );
  const captainB = participants.find(
    (participant) => participant.captain && participant.team === "B",
  );
  if (captainA === undefined || captainB === undefined)
    throw new Error("Both teams require a captain");
  return { A: captainA.discordId, B: captainB.discordId };
}

function resetGameParticipants(
  participants: readonly CustomGameParticipant[],
): CustomGameParticipant[] {
  return participants.map((participant) => ({
    ...participant,
    pickOrder: null,
    championId: null,
    won: null,
  }));
}

export function customIntermissionOutcome(
  snapshot: CustomNightSnapshot,
  choice: CustomIntermissionChoice,
): {
  participants: CustomGameParticipant[];
  state: "CAPTAINS_SET" | "DRAFTING";
  activeCaptain: CustomTeam | null;
} {
  const prior = resetGameParticipants(currentGame(snapshot).participants);
  if (choice === "KEEP_TEAMS_AND_CAPTAINS") {
    return { participants: prior, state: "CAPTAINS_SET", activeCaptain: null };
  }
  if (choice === "KEEP_TEAMS_REROLL_CAPTAINS") {
    return {
      participants: rerollCaptainsWithinTeams(prior),
      state: "CAPTAINS_SET",
      activeCaptain: null,
    };
  }
  if (choice === "REDRAFT_NEW_CAPTAINS") {
    return {
      participants: selectCaptainsExcludingPrevious(prior),
      state: "DRAFTING",
      activeCaptain: "A",
    };
  }
  return {
    participants: prior.map((participant) =>
      participant.captain
        ? participant
        : { ...participant, team: null, side: null },
    ),
    state: "DRAFTING",
    activeCaptain: "A",
  };
}

export async function startCustomGame(params: {
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
    action: "GAME_STARTED",
    payload: {},
    update: (snapshot) => {
      assertCustomHostControl(
        snapshot,
        params.actor.discordId,
        params.actor.discordAdministrator,
      );
      const game = currentGame(snapshot);
      if (!game.voiceReady && !game.voiceOverride)
        throw new Error(
          "Resolve voice movement or explicitly continue manually",
        );
      return refreshSnapshot(
        {
          ...snapshot,
          state: transitionCustomNight(snapshot.state, {
            type: "GAME_STARTED",
          }),
          currentGame: {
            ...game,
            state: transitionCustomGame(game.state, { type: "GAME_STARTED" }),
            startedAt: now.toISOString(),
          },
        },
        now,
      );
    },
  });
}

export async function overrideCustomVoice(params: {
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
    action: "VOICE_MANUAL_OVERRIDE",
    payload: {},
    update: (snapshot) => {
      assertCustomHostControl(
        snapshot,
        params.actor.discordId,
        params.actor.discordAdministrator,
      );
      const game = currentGame(snapshot);
      if (game.voiceReady)
        throw new Error("Voice movement already completed successfully");
      if (hasActiveVoiceArrangementProvisioning(game, now))
        throw new Error(
          "Wait for voice arrangement to finish before continuing manually",
        );
      return refreshSnapshot(
        {
          ...snapshot,
          currentGame: { ...game, voiceOverride: true },
        },
        now,
      );
    },
  });
}

export async function recordCustomVoiceFailure(params: {
  prisma: ExtendedPrismaClient;
  nightId: string;
  expectedRevision: number;
  actorDiscordId: string;
  message: string;
}): Promise<CustomMutationResult> {
  return await commitCustomMutation({
    prisma: params.prisma,
    nightId: params.nightId,
    expectedRevision: params.expectedRevision,
    actorDiscordId: params.actorDiscordId,
    action: "VOICE_ARRANGEMENT_FAILED",
    payload: { failures: [params.message] },
    update: (current) => {
      const game = currentGame(current);
      return refreshSnapshot(
        {
          ...current,
          currentGame: {
            ...game,
            voiceReady: false,
            voiceError: params.message,
            voiceArrangementProvisioning: null,
          },
        },
        new Date(),
      );
    },
  });
}

export async function continueCustomNight(params: {
  prisma: ExtendedPrismaClient;
  actor: CustomActor;
  nightId: string;
  expectedRevision: number;
  choice: CustomIntermissionChoice;
  now?: Date;
}): Promise<CustomMutationResult> {
  const original = await getCustomNight(params.prisma, params.nightId);
  if (original === null) throw new Error("Custom night not found");
  const outcome = customIntermissionOutcome(original, params.choice);
  const captains = captainIds(outcome.participants);
  const priorGame = currentGame(original);
  const now = params.now ?? new Date();
  return await commitCustomMutation({
    ...params,
    actorDiscordId: params.actor.discordId,
    action: "INTERMISSION_CHOICE_APPLIED",
    payload: { choice: params.choice, captains },
    update: (snapshot) => {
      assertCustomHostControl(
        snapshot,
        params.actor.discordId,
        params.actor.discordAdministrator,
      );
      const current = currentGame(snapshot);
      const roster = current.participants.map((gameParticipant) => {
        const participant = snapshot.participants.find(
          (candidate) => candidate.discordId === gameParticipant.discordId,
        );
        if (participant === undefined)
          throw new Error("Roster participant left the night");
        return participant;
      });
      assertRosterLockable(roster);
      let state = transitionCustomNight(snapshot.state, {
        type: "PREPARE_NEXT_GAME",
      });
      if (outcome.state === "DRAFTING")
        state = transitionCustomNight(state, { type: "START_DRAFT" });
      const gameState =
        outcome.state === "DRAFTING"
          ? transitionCustomGame(
              transitionCustomGame("ROSTER_OPEN", {
                type: "CAPTAINS_SELECTED",
              }),
              { type: "START_DRAFT" },
            )
          : transitionCustomGame("ROSTER_OPEN", {
              type: "CAPTAINS_SELECTED",
            });
      const game = CustomGameSnapshotSchema.parse({
        id: globalThis.crypto.randomUUID(),
        sequence: priorGame.sequence + 1,
        state: gameState,
        rosterMode: priorGame.rosterMode,
        map: priorGame.map,
        pickMode: priorGame.pickMode,
        participants: outcome.participants,
        activeCaptain: outcome.activeCaptain,
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
      return refreshSnapshot({ ...snapshot, state, currentGame: game }, now);
    },
  });
}
