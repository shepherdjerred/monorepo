import {
  matchupRow,
  type MatchupRow,
} from "#src/components/champions/matchups.ts";
import {
  spellAsset,
  spellName,
  type CatalogAsset,
} from "#src/components/champions/catalog.ts";
import { matchupHref, pageOpponents } from "./pages.ts";
import { matchupContextLine } from "#src/lib/champion-meta/public-context.ts";
import { roleLabel } from "#src/lib/champion-meta/snapshot.ts";
import type {
  MatchupRecord,
  SnapshotChampion,
  SnapshotIndex,
  SnapshotMatchup,
} from "#src/lib/champion-meta/snapshot-v2-schema.ts";

/**
 * Everything the public matchup page states, worked out from one matchup file
 * and the two champion files around it. Words are chosen here so the page
 * claims only what an interval supports: an edge is named when the matchup's
 * interval is wholly on one side of 50%, and a figure the file does not hold
 * is left out, never filled in.
 */

type Rate = { value: number; lower: number; upper: number };

export type Edge = "champion" | "opponent" | "even";

/** Which side an interval is wholly on, or even when it spans 50%. */
export function edgeOf(rate: Rate): Edge {
  if (rate.lower > 0.5) return "champion";
  return rate.upper < 0.5 ? "opponent" : "even";
}

export type SpellSide = {
  label: string;
  assets: CatalogAsset[];
  winRate: number;
  games: number;
};

/** "Ahri players who take Teleport win this more often than those who take Ignite." */
export type SpellFact = { better: SpellSide; worse: SpellSide };

export type LaneModel = {
  lead: string;
  label: string;
  /** Percent. */
  aheadRate: number;
  range: { low: number; high: number };
  games: number;
  /** The champion's own lane figure across every opponent, when its slice holds one. */
  overall: string | null;
};

export type MatchupPageModel = {
  title: string;
  description: string;
  lead: string;
  sub: string;
  context: string;
  /** The page from the other champion's side, when that side has one. */
  otherSide: { href: string } | null;
  lane: LaneModel | null;
  spellFact: SpellFact | null;
  others: (MatchupRow & { href: string })[];
};

const OTHERS_SHOWN = 5;

type SpellPair = NonNullable<MatchupRecord["spells"]>[number];

function sideOf(pair: SpellPair, other: SpellPair): SpellSide {
  const own = pair.spellIds.filter((id) => !other.spellIds.includes(id));
  // Pairs usually share Flash; name only what differs, or the whole pair when
  // nothing is shared.
  const named = own.length > 0 ? own : pair.spellIds;
  return {
    label: named.map((id) => spellName(id)).join(" and "),
    assets: named.map((id) => spellAsset(id)),
    winRate: pair.winRate.value * 100,
    games: pair.games,
  };
}

/**
 * The two most played spell pairs, when their win-rate intervals do not
 * overlap. Anything closer is not a difference this sample can show.
 */
export function spellFactOf(
  spells: MatchupRecord["spells"] | undefined,
): SpellFact | null {
  const [first, second] = (spells ?? []).toSorted((a, b) => b.games - a.games);
  if (first === undefined || second === undefined) return null;
  if (first.winRate.lower > second.winRate.upper) {
    return { better: sideOf(first, second), worse: sideOf(second, first) };
  }
  return second.winRate.lower > first.winRate.upper
    ? { better: sideOf(second, first), worse: sideOf(first, second) }
    : null;
}

/** "1,050 games", "1 game". */
export function gamesLabel(games: number): string {
  return `${games.toLocaleString("en-US")} ${games === 1 ? "game" : "games"}`;
}

function percentText(value: number): string {
  return `${value.toFixed(1)}%`;
}

function leadOf(edge: Edge, champion: string, opponent: string): string {
  if (edge === "champion") return `${champion} has the edge.`;
  return edge === "opponent"
    ? `${opponent} has the edge.`
    : "Neither side has the edge.";
}

function laneOf(
  record: MatchupRecord,
  names: { champion: string; opponent: string },
  slice: SnapshotChampion["slices"][number] | undefined,
): LaneModel | null {
  const { lane } = record;
  if (lane === undefined) return null;
  const edge = edgeOf(lane.aheadRate);
  const overall = slice?.lane;
  return {
    lead:
      edge === "even"
        ? "Neither side usually gets ahead"
        : `${edge === "champion" ? names.champion : names.opponent} usually gets ahead`,
    label: `${names.champion} is ahead at 15 minutes`,
    aheadRate: lane.aheadRate.value * 100,
    range: {
      low: lane.aheadRate.lower * 100,
      high: lane.aheadRate.upper * 100,
    },
    games: lane.games,
    overall:
      overall === undefined
        ? null
        : `Against everyone, ${names.champion} is ahead ${percentText(overall.aheadRate.value * 100)} of the time, from ${overall.games.toLocaleString("en-US")} games.`,
  };
}

export function matchupPageModel(input: {
  matchup: SnapshotMatchup;
  /** The champion file the page is written from. */
  champion: SnapshotChampion;
  /** The opponent's champion file, to find the page from their side. */
  opponentChampion: SnapshotChampion;
  index: SnapshotIndex;
}): MatchupPageModel {
  const { matchup, champion, opponentChampion, index } = input;
  const { role } = matchup.context;
  const { record } = matchup.champion;
  const names = { champion: champion.name, opponent: matchup.opponent.name };
  const slice = champion.slices.find((entry) => entry.context.role === role);
  const lane = laneOf(record, names, slice);
  const edge = edgeOf(record.winRate);
  const others = (
    champion.matchups.find((group) => group.role === role)?.opponents ?? []
  )
    .filter((entry) => entry.id !== matchup.opponent.id)
    .slice(0, OTHERS_SHOWN)
    .map((entry) => ({
      ...matchupRow(entry),
      href: matchupHref(champion.slug, role, entry.slug),
    }));
  const hasOtherSide = pageOpponents(opponentChampion, role).has(champion.slug);
  return {
    title: `${names.champion} vs ${names.opponent} ${roleLabel(role)} matchup · Scout for LoL`,
    description: `${names.champion} against ${names.opponent}: win rate and lane results from ${gamesLabel(record.games)}, with the patch, queue, rank bracket and dates behind them.`,
    lead: leadOf(edge, names.champion, names.opponent),
    sub: `${names.champion} wins ${percentText(record.winRate.value * 100)} of ${gamesLabel(record.games)} against ${names.opponent}.`,
    context: matchupContextLine(role, record.games, index, lane !== null),
    otherSide: hasOtherSide
      ? { href: matchupHref(opponentChampion.slug, role, champion.slug) }
      : null,
    lane,
    spellFact: spellFactOf(record.spells),
    others,
  };
}
