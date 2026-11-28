import { getChampionDisplayName, type Lane } from "@scout-for-lol/data";
import {
  buildGameKey,
  type ChampionBuildInputs,
  type LakeBuildGame,
} from "#src/reports/duckdb/consumer/pages/champion-build-reads.ts";
import type { ChampionPagePerson } from "#src/trpc/router/consumer/consumer-champion-people.ts";
import {
  coreBuildOf,
  type CoreBuild,
} from "#src/trpc/router/consumer/champion-builds/core-build.ts";

/** How many alternatives a slot lists. */
export const MAX_OPTIONS = 3;

/** How many friends can be noted for building differently. */
export const MAX_FIRST_ITEM_NOTES = 5;

/** One choice for a slot, with the games it was made in and how many were won. */
export type BuildOption<Value> = { value: Value; games: number; wins: number };

/**
 * A slot's most common choices, most played first. `games` is the games the
 * slot is known for, so the options' games add up to at most `games`; counts,
 * never a rate, so the page can judge a small sample.
 */
export type SlotTally<Value> = {
  games: number;
  options: BuildOption<Value>[];
};

/** What a set of players built on the champion. */
export type ChampionSetup = {
  /** Their games on the champion, whatever is known of each. */
  games: number;
  /** The first three finished items, in purchase order, as item ids. */
  coreBuild: SlotTally<CoreBuild>;
  /** The keystone rune, as a rune id. */
  keystone: SlotTally<number>;
};

/** A friend whose usual first finished item is not the group's. */
export type FirstItemNote = {
  playerId: number;
  alias: string;
  itemId: number;
  /** Their games that opened with `itemId`, and how many were won. */
  games: number;
  wins: number;
  /** Their games with a core build. */
  ofGames: number;
};

export type ChampionBuilds = {
  champion: { championId: number; name: string };
  /** The lane asked for, or `null` for every lane. */
  lane: Lane | null;
  friends: ChampionSetup;
  /** The viewer's own setup, or `null` when they have no game on the champion. */
  you: ChampionSetup | null;
  /** Friends who open differently from `friends.coreBuild`'s first option. */
  differing: FirstItemNote[];
};

type Sample<Value> = { value: Value; win: boolean };

/** Most played first; a tie goes to the more won, then to the lower key. */
function tally<Value>(
  samples: readonly Sample<Value>[],
  keyOf: (value: Value) => string,
): SlotTally<Value> {
  const byKey = new Map<string, BuildOption<Value>>();
  for (const sample of samples) {
    const key = keyOf(sample.value);
    const option = byKey.get(key) ?? {
      value: sample.value,
      games: 0,
      wins: 0,
    };
    option.games += 1;
    if (sample.win) option.wins += 1;
    byKey.set(key, option);
  }
  const ordered = [...byKey.entries()].toSorted(
    ([leftKey, left], [rightKey, right]) =>
      right.games - left.games ||
      right.wins - left.wins ||
      leftKey.localeCompare(rightKey, "en-US", { numeric: true }),
  );
  return {
    games: samples.length,
    options: ordered.slice(0, MAX_OPTIONS).map(([, option]) => option),
  };
}

const sequenceKey = (items: readonly number[]) => items.join(",");
const idKey = (id: number) => id.toString();

type ResolvedGame = {
  game: LakeBuildGame;
  core: CoreBuild | null;
};

function setupOf(resolved: readonly ResolvedGame[]): ChampionSetup {
  return {
    games: resolved.length,
    coreBuild: tally(
      resolved.flatMap(({ game, core }) =>
        core === null ? [] : [{ value: core, win: game.win }],
      ),
      sequenceKey,
    ),
    keystone: tally(
      resolved.flatMap(({ game }) =>
        game.keystone === null ? [] : [{ value: game.keystone, win: game.win }],
      ),
      idKey,
    ),
  };
}

function firstItemNotes(options: {
  friends: ReadonlyMap<string, readonly ResolvedGame[]>;
  people: ReadonlyMap<string, ChampionPagePerson>;
  groupFirstItem: number;
}): FirstItemNote[] {
  const notes: FirstItemNote[] = [];
  for (const [entryKey, resolved] of options.friends) {
    const person = options.people.get(entryKey);
    if (person === undefined) {
      throw new Error("Champion builds returned an unrequested player");
    }
    const opened = tally(
      resolved.flatMap(({ game, core }) =>
        core === null ? [] : [{ value: core[0], win: game.win }],
      ),
      String,
    );
    const usual = opened.options[0];
    if (usual === undefined) continue;
    if (usual.value === options.groupFirstItem) continue;
    notes.push({
      playerId: person.playerId,
      alias: person.alias,
      itemId: usual.value,
      games: usual.games,
      wins: usual.wins,
      ofGames: opened.games,
    });
  }
  return notes
    .toSorted(
      (left, right) =>
        right.games - left.games ||
        left.alias.localeCompare(right.alias) ||
        left.playerId - right.playerId,
    )
    .slice(0, MAX_FIRST_ITEM_NOTES);
}

/**
 * What the viewer's friends build on a champion, and what the viewer does.
 *
 * Friends are everyone on the page but the viewer; a person with several
 * accounts or servers is one person, and a game is counted once. A game
 * without a timeline has a keystone but no core build.
 */
export function buildChampionBuilds(options: {
  championId: number;
  lane: Lane | undefined;
  inputs: ChampionBuildInputs;
  people: readonly ChampionPagePerson[];
}): ChampionBuilds {
  const personByKey = new Map(
    options.people.map(
      (person) => [person.playerId.toString(), person] as const,
    ),
  );
  const eventsByGame = Map.groupBy(options.inputs.events, (event) =>
    buildGameKey(event.match_id, event.participant_id),
  );
  const friendGames = new Map<string, ResolvedGame[]>();
  const yourGames: ResolvedGame[] = [];
  for (const game of options.inputs.games) {
    const person = personByKey.get(game.entryKey);
    if (person === undefined) {
      throw new Error("Champion builds returned an unrequested player");
    }
    const events =
      game.participantId === null
        ? undefined
        : eventsByGame.get(buildGameKey(game.matchId, game.participantId));
    const resolved: ResolvedGame = {
      game,
      core: events === undefined ? null : coreBuildOf(events),
    };
    if (person.isViewer) {
      yourGames.push(resolved);
      continue;
    }
    friendGames.set(game.entryKey, [
      ...(friendGames.get(game.entryKey) ?? []),
      resolved,
    ]);
  }
  const friends = setupOf([...friendGames.values()].flat());
  const groupFirstItem = friends.coreBuild.options[0]?.value[0];
  return {
    champion: {
      championId: options.championId,
      name: getChampionDisplayName(options.championId),
    },
    lane: options.lane ?? null,
    friends,
    you: yourGames.length === 0 ? null : setupOf(yourGames),
    differing:
      groupFirstItem === undefined
        ? []
        : firstItemNotes({
            friends: friendGames,
            people: personByKey,
            groupFirstItem,
          }),
  };
}
