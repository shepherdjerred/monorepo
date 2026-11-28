import { getChampionDisplayName, type Lane } from "@scout-for-lol/data";
import type {
  ChampionMatchupInputs,
  LakeMatchupFrame,
  LakeMatchupGame,
  LakeMatchupParticipant,
} from "#src/reports/duckdb/consumer/pages/champion-matchup-reads.ts";
import { buildRoleMatchups } from "#src/reports/lanes/role-matchups.ts";
import type { ChampionPagePerson } from "#src/trpc/router/consumer/consumer-champion-people.ts";

/** Games against one opponent, with the lane result of those that have a timeline. */
export type MatchupTally = {
  games: number;
  wins: number;
  /** Ahead at 15 minutes: `ahead` of the `games` that have a 15-minute frame. */
  ahead15: { games: number; ahead: number };
};

export type ChampionMatchupEntry = {
  opponent: { championId: number; name: string };
  /** The viewer's games plus the friends', for ordering. */
  games: number;
  you: MatchupTally | null;
  friends: MatchupTally | null;
};

function emptyTally(): MatchupTally {
  return { games: 0, wins: 0, ahead15: { games: 0, ahead: 0 } };
}

type LaneGame = {
  opponent: LakeMatchupParticipant;
  /** Gold lead over the opponent at 15:00; null when there is no 15:00 frame. */
  goldLead: number | null;
};

/**
 * The opponent in `lane` and the gold lead over them at 15:00, or undefined
 * when the match cannot be role-paired. This is `buildRoleMatchups`' pairing
 * and checkpoint, read from the viewer's side of the match.
 */
function laneGame(options: {
  lane: Lane;
  game: LakeMatchupGame;
  rows: LakeMatchupParticipant[];
  frames: LakeMatchupFrame[];
}): LaneGame | undefined {
  const pairing = buildRoleMatchups({
    rows: options.rows,
    frames: options.frames,
  })?.find((matchup) => matchup.role === options.lane);
  if (pairing === undefined) return undefined;
  const blue = options.game.teamId === 100;
  const opponentId = blue
    ? pairing.redParticipantId
    : pairing.blueParticipantId;
  const opponent = options.rows.find(
    (row) => row.participant_id === opponentId,
  );
  if (opponent === undefined) {
    throw new Error(
      `Matchup for ${options.game.matchId} names a missing opponent`,
    );
  }
  if (pairing.at15 === null) return { opponent, goldLead: null };
  return {
    opponent,
    goldLead: blue ? pairing.at15.goldDelta : -pairing.at15.goldDelta,
  };
}

function addGame(tally: MatchupTally, win: boolean, goldLead: number | null) {
  tally.games += 1;
  if (win) tally.wins += 1;
  if (goldLead === null) return;
  tally.ahead15.games += 1;
  if (goldLead > 0) tally.ahead15.ahead += 1;
}

/**
 * How the viewer and their friends did against each opponent in a lane.
 *
 * The opponent is the same-role player on the other team and "ahead at 15" is
 * `buildRoleMatchups`' rule (the checkpoint frame's gold strictly greater than
 * that opponent's). A game that cannot be role-paired has no opponent and is
 * left out; a game with no 15-minute frame counts as a game but not in the
 * ahead figure. The planned `lane_results` table replaces the frame reads
 * behind this and keeps the same definition.
 */
export function buildChampionMatchups(options: {
  lane: Lane;
  inputs: ChampionMatchupInputs;
  people: readonly ChampionPagePerson[];
}): ChampionMatchupEntry[] {
  const personByKey = new Map(
    options.people.map(
      (person) => [person.playerId.toString(), person] as const,
    ),
  );
  const participantsByMatch = Map.groupBy(
    options.inputs.participants,
    (row) => row.match_id,
  );
  const framesByMatch = Map.groupBy(
    options.inputs.frames,
    (frame) => frame.match_id,
  );
  const byOpponent = new Map<
    number,
    { name: string; you: MatchupTally; friends: MatchupTally }
  >();
  for (const game of options.inputs.games) {
    const person = personByKey.get(game.entryKey);
    if (person === undefined) {
      throw new Error("Champion matchups returned an unrequested player");
    }
    const resolved = laneGame({
      lane: options.lane,
      game,
      rows: participantsByMatch.get(game.matchId) ?? [],
      frames: framesByMatch.get(game.matchId) ?? [],
    });
    if (resolved === undefined) continue;
    const entry = byOpponent.get(resolved.opponent.champion_id) ?? {
      name: getChampionDisplayName(resolved.opponent.champion_id),
      you: emptyTally(),
      friends: emptyTally(),
    };
    addGame(
      person.isViewer ? entry.you : entry.friends,
      game.win,
      resolved.goldLead,
    );
    byOpponent.set(resolved.opponent.champion_id, entry);
  }
  return [...byOpponent.entries()]
    .map(([championId, entry]): ChampionMatchupEntry => ({
      opponent: { championId, name: entry.name },
      games: entry.you.games + entry.friends.games,
      you: entry.you.games === 0 ? null : entry.you,
      friends: entry.friends.games === 0 ? null : entry.friends,
    }))
    .toSorted(
      (left, right) =>
        right.games - left.games ||
        left.opponent.name.localeCompare(right.opponent.name) ||
        left.opponent.championId - right.opponent.championId,
    );
}
