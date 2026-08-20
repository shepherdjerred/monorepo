import type {
  CustomGameParticipant,
  CustomNightParticipant,
  CustomRosterMode,
  CustomTeam,
} from "@scout-for-lol/data";
import { secureShuffle, type SecureRandom } from "#src/customs/random.ts";

export const CUSTOM_DRAFT_ORDER: readonly CustomTeam[] = [
  "A",
  "B",
  "B",
  "A",
  "A",
  "B",
  "B",
  "A",
] as const;

function readyTime(participant: CustomNightParticipant): number {
  if (participant.held) return Number.MIN_SAFE_INTEGER;
  if (participant.readyAt === null) return Number.MAX_SAFE_INTEGER;
  return new Date(participant.readyAt).getTime();
}

function rosterEligible(participant: CustomNightParticipant): boolean {
  return (
    participant.held ||
    (participant.availability === "READY" &&
      participant.awayUntil === null &&
      !participant.awayOverdue)
  );
}

function requireTen<T>(values: readonly T[]): readonly T[] {
  if (values.length !== 10) {
    throw new Error(
      `A custom roster requires exactly 10 players, received ${values.length.toString()}`,
    );
  }
  return values;
}

export function selectCustomRoster(params: {
  participants: readonly CustomNightParticipant[];
  mode: CustomRosterMode;
  selectedDiscordIds: readonly string[];
  random?: SecureRandom;
}): readonly CustomNightParticipant[] {
  const eligible = params.participants.filter((participant) =>
    rosterEligible(participant),
  );
  if (eligible.length < 10)
    throw new Error("At least 10 ready or held players are required");

  if (params.mode === "FIRST_TEN") {
    return requireTen(
      eligible
        .toSorted((left, right) => readyTime(left) - readyTime(right))
        .slice(0, 10),
    );
  }

  if (params.mode === "RANDOM_TEN") {
    return requireTen(secureShuffle(eligible, params.random).slice(0, 10));
  }

  if (new Set(params.selectedDiscordIds).size !== 10) {
    throw new Error("Host-selected rosters require 10 distinct players");
  }
  const selected = params.selectedDiscordIds.map((discordId) => {
    const participant = eligible.find(
      (candidate) => candidate.discordId === discordId,
    );
    if (participant === undefined)
      throw new Error(`Selected player ${discordId} is not eligible`);
    return participant;
  });
  return requireTen(selected);
}

export function assertRosterLockable(
  roster: readonly CustomNightParticipant[],
): void {
  requireTen(roster);
  for (const participant of roster) {
    if (!rosterEligible(participant)) {
      throw new Error(`${participant.displayName} is no longer ready or held`);
    }
    if (participant.awayUntil !== null || participant.awayOverdue) {
      throw new Error(`${participant.displayName} is still away`);
    }
  }
  assertRosterIdentity(roster);
}

export function assertRosterIdentity(
  roster: readonly CustomNightParticipant[],
): void {
  requireTen(roster);
  for (const participant of roster) {
    if (participant.playerId === null || participant.playerAlias === null) {
      throw new Error(
        `${participant.displayName} needs a Scout player mapping`,
      );
    }
    if (participant.selectedAccountId === null) {
      throw new Error(`${participant.displayName} must select an NA1 account`);
    }
    const account = participant.accounts.find(
      (candidate) => candidate.accountId === participant.selectedAccountId,
    );
    if (account === undefined) {
      throw new Error(
        `${participant.displayName} must select a valid NA1 account`,
      );
    }
  }
}

export function snapshotRoster(
  roster: readonly CustomNightParticipant[],
): CustomGameParticipant[] {
  assertRosterIdentity(roster);
  return roster.map((participant, rosterOrder) =>
    snapshotCustomParticipant(participant, rosterOrder),
  );
}

export function snapshotCustomParticipant(
  participant: CustomNightParticipant,
  rosterOrder: number,
): CustomGameParticipant {
  const selectedAccountId = participant.selectedAccountId;
  const playerId = participant.playerId;
  const playerAlias = participant.playerAlias;
  if (selectedAccountId === null || playerId === null || playerAlias === null) {
    throw new Error(`${participant.displayName} needs a Scout NA1 identity`);
  }
  const account = participant.accounts.find(
    (candidate) => candidate.accountId === selectedAccountId,
  );
  if (account === undefined)
    throw new Error(`${participant.displayName} needs a selected NA1 account`);
  return {
    discordId: participant.discordId,
    displayName: participant.displayName,
    playerId,
    playerAlias,
    accountId: account.accountId,
    puuid: account.puuid,
    riotGameName: account.riotGameName,
    riotTagLine: account.riotTagLine,
    rosterOrder,
    benchOrder: null,
    team: null,
    side: null,
    captain: false,
    pickOrder: null,
    championId: null,
    won: null,
  };
}

export function selectCaptains(
  participants: readonly CustomGameParticipant[],
  random?: SecureRandom,
): CustomGameParticipant[] {
  requireTen(participants);
  const shuffled = secureShuffle(participants, random);
  const captainA = shuffled[0];
  const captainB = shuffled[1];
  if (captainA === undefined || captainB === undefined) {
    throw new Error("Captain selection requires two players");
  }
  return participants.map((participant) => {
    if (participant.discordId === captainA.discordId) {
      return { ...participant, captain: true, team: "A", side: "BLUE" };
    }
    if (participant.discordId === captainB.discordId) {
      return { ...participant, captain: true, team: "B", side: "RED" };
    }
    return participant;
  });
}

export function rerollCaptainsWithinTeams(
  participants: readonly CustomGameParticipant[],
  random?: SecureRandom,
): CustomGameParticipant[] {
  requireTen(participants);
  const teamA = secureShuffle(
    participants.filter(
      (participant) => participant.team === "A" && !participant.captain,
    ),
    random,
  );
  const teamB = secureShuffle(
    participants.filter(
      (participant) => participant.team === "B" && !participant.captain,
    ),
    random,
  );
  const captainA = teamA[0];
  const captainB = teamB[0];
  if (captainA === undefined || captainB === undefined)
    throw new Error("Each team needs a non-captain to reroll captains");
  return participants.map((participant) => ({
    ...participant,
    captain:
      participant.discordId === captainA.discordId ||
      participant.discordId === captainB.discordId,
  }));
}

export function selectCaptainsExcludingPrevious(
  participants: readonly CustomGameParticipant[],
  random?: SecureRandom,
): CustomGameParticipant[] {
  requireTen(participants);
  const eligible = participants.filter((participant) => !participant.captain);
  const candidates = eligible.length >= 2 ? eligible : [...participants];
  const selected = secureShuffle(candidates, random).slice(0, 2);
  const captainA = selected[0];
  const captainB = selected[1];
  if (captainA === undefined || captainB === undefined)
    throw new Error("Captain reroll requires two eligible players");
  return participants.map((participant) => {
    if (participant.discordId === captainA.discordId) {
      return { ...participant, captain: true, team: "A", side: "BLUE" };
    }
    if (participant.discordId === captainB.discordId) {
      return { ...participant, captain: true, team: "B", side: "RED" };
    }
    return {
      ...participant,
      captain: false,
      team: null,
      side: null,
      pickOrder: null,
    };
  });
}

export function activeDraftTeam(
  participants: readonly CustomGameParticipant[],
): CustomTeam | null {
  const picks = participants.filter(
    (participant) => participant.pickOrder !== null,
  ).length;
  return CUSTOM_DRAFT_ORDER[picks] ?? null;
}

export function assertCustomTeamsComplete(
  participants: readonly CustomGameParticipant[],
): void {
  requireTen(participants);
  const teamA = participants.filter(
    (participant) => participant.team === "A" && participant.side === "BLUE",
  );
  const teamB = participants.filter(
    (participant) => participant.team === "B" && participant.side === "RED",
  );
  if (teamA.length !== 5 || teamB.length !== 5) {
    throw new Error("Each custom team must contain five assigned players");
  }
}

export function pickCustomPlayer(params: {
  participants: readonly CustomGameParticipant[];
  captainDiscordId: string;
  pickedDiscordId: string;
}): CustomGameParticipant[] {
  const activeTeam = activeDraftTeam(params.participants);
  if (activeTeam === null) throw new Error("The draft is already complete");
  const captain = params.participants.find(
    (participant) => participant.discordId === params.captainDiscordId,
  );
  if (
    captain === undefined ||
    !captain.captain ||
    captain.team !== activeTeam
  ) {
    throw new Error(`Only Team ${activeTeam}'s captain may pick`);
  }
  const picked = params.participants.find(
    (participant) => participant.discordId === params.pickedDiscordId,
  );
  if (picked === undefined || picked.captain || picked.team !== null) {
    throw new Error("The selected player is not available to draft");
  }
  const pickOrder =
    params.participants.filter((participant) => participant.pickOrder !== null)
      .length + 1;
  return params.participants.map((participant) =>
    participant.discordId === params.pickedDiscordId
      ? {
          ...participant,
          team: activeTeam,
          side: activeTeam === "A" ? "BLUE" : "RED",
          pickOrder,
        }
      : participant,
  );
}

export function undoCustomPick(
  participants: readonly CustomGameParticipant[],
): CustomGameParticipant[] {
  const latest = Math.max(
    0,
    ...participants.map((participant) => participant.pickOrder ?? 0),
  );
  if (latest === 0) throw new Error("There is no draft pick to undo");
  return participants.map((participant) =>
    participant.pickOrder === latest
      ? { ...participant, team: null, side: null, pickOrder: null }
      : participant,
  );
}
