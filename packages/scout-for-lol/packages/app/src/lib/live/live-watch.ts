import {
  championName,
  lanePerson,
  laneOf,
  orderedTeams,
  type LiveGameData,
  type LiveParticipant,
} from "#src/lib/live/live-game.ts";

export type WatchLine = {
  championId: number;
  /** The words before the name: "Their jungler,". */
  before: string;
  name: string;
  /** The rest of the sentence: "has won 5 in a row." */
  after: string;
};

/** A line and the length of the winning run behind it, for ordering. */
type Candidate = { streak: number; line: WatchLine };

/** The most things worth watching a page lists. */
export const MAX_WATCH_LINES = 3;

/** A winning run at least this long is worth a line. */
const MIN_WATCHED_STREAK = 3;

/** At most this many of the last five games on the champion reads as new to it. */
const NEW_ON_CHAMPION_AT_MOST = 1;

/** At least this many recent games must be behind "has won all of them". */
const MIN_COMFORT_GAMES = 2;

/** The Riot ID without its tag, for a stranger only: a friend is not "their" anything. */
function theirName(participant: LiveParticipant): string | null {
  return participant.friend === null
    ? (participant.riotId?.split("#")[0] ?? null)
    : null;
}

function theirRole(participant: LiveParticipant): string {
  const lane = laneOf(participant);
  return lane === null
    ? `Their ${championName(participant.championId)}`
    : `Their ${lanePerson(lane)}`;
}

function candidate(
  participant: LiveParticipant,
  name: string,
  after: string,
  streak: number,
): Candidate {
  return {
    streak,
    line: {
      championId: participant.championId,
      before: `${theirRole(participant)},`,
      name,
      after,
    },
  };
}

function streakLines(participant: LiveParticipant, name: string): Candidate[] {
  const form = participant.recentForm;
  if (form?.status !== "fetched") return [];
  const run = form.streak;
  if (run?.result !== "win" || run.length < MIN_WATCHED_STREAK) return [];
  return [
    candidate(
      participant,
      name,
      `has won ${run.length.toString()} in a row.`,
      run.length,
    ),
  ];
}

function championLines(
  participant: LiveParticipant,
  name: string,
): Candidate[] {
  const form = participant.recentForm;
  if (form?.status !== "fetched" || form.games === 0) return [];
  const champion = championName(participant.championId);
  const games = form.games.toString();
  if (form.gamesOnChampion <= NEW_ON_CHAMPION_AT_MOST) {
    const played =
      form.gamesOnChampion === 0
        ? `has not played ${champion}`
        : `has played ${champion} once`;
    return [
      candidate(
        participant,
        name,
        `${played} in their last ${games} ranked games.`,
        0,
      ),
    ];
  }
  if (
    form.gamesOnChampion >= MIN_COMFORT_GAMES &&
    form.winsOnChampion === form.gamesOnChampion
  ) {
    return [
      candidate(
        participant,
        name,
        `has won ${form.winsOnChampion.toString()} of ${form.gamesOnChampion.toString()} recent ranked games on ${champion}.`,
        0,
      ),
    ];
  }
  return [];
}

/**
 * What is worth knowing about the other team, from what Scout read about each
 * of them: a winning run, a champion they rarely play, one they always win on.
 * Streaks come first, longest first, then the rest in lobby order.
 */
export function watchLines(game: LiveGameData): WatchLine[] {
  const [mine] = orderedTeams(game);
  if (mine === undefined) return [];
  return game.participants
    .filter((participant) => participant.teamId !== mine.teamId)
    .flatMap((participant) => {
      const name = theirName(participant);
      return name === null
        ? []
        : [
            ...streakLines(participant, name),
            ...championLines(participant, name),
          ];
    })
    .toSorted((a, b) => b.streak - a.streak)
    .slice(0, MAX_WATCH_LINES)
    .map((entry) => entry.line);
}
