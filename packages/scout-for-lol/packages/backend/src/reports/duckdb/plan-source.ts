import { match } from "ts-pattern";
import type { ScoutQlPlan } from "@scout-for-lol/data/model/scoutql/parse/plan.ts";
import type { PlanColumnSource } from "#src/reports/duckdb/column-map.ts";
import type { LakeQueryScope } from "#src/reports/duckdb/scope.ts";
import type { ServerPerson } from "#src/reports/server-people.ts";
import {
  namesPairSubject,
  PAIR_KEYS_SCAN_FILTER,
} from "#src/reports/duckdb/pair-sql.ts";
import {
  buildMatchesSource,
  buildMatchDimensionSource,
  buildMatchTeamsSource,
  buildParticipantDimensionSource,
  buildTimelineEventParticipantsSource,
  buildFrameGoldSource,
  type LakeFiles,
  type SqlFragment,
} from "#src/reports/duckdb/lake.ts";
import { readsMatchDimension } from "#src/reports/duckdb/column-map.ts";
import {
  EVENT_KEYS_SCAN_FILTER,
  FRAME_KEYS_SCAN_FILTER,
  type FactsCteInput,
} from "#src/reports/duckdb/facts-cte.ts";
import { combineAnd, frag } from "#src/reports/duckdb/sql-fragment.ts";

/**
 * Which rows a plan reads, and which scopes it may be read in.
 *
 * Every lake-backed source maps to one column source and one time column,
 * and some refuse a scope outright — a row that names no player cannot be
 * narrowed to a server. Kept apart from the compiler because each new source
 * adds a case here and nowhere near the SQL it compiles to.
 */

export type SourceKind = {
  columnSource: PlanColumnSource;
  timeColumn: "game_creation_at" | "observed_at";
};

export function planSourceKind(
  plan: ScoutQlPlan,
  forGroupFacts: boolean,
): SourceKind {
  const kind = match(plan.source)
    .with(
      "match_participants",
      "competition_match_participants",
      "player_groups",
      (): SourceKind => ({
        columnSource: "match",
        timeColumn: "game_creation_at",
      }),
    )
    // A pair's own player is a participant row; the other is a lookup.
    .with("match_pairs", (): SourceKind => ({
      columnSource: "match-pair",
      timeColumn: "game_creation_at",
    }))
    .with("prematch_participants", (): SourceKind => ({
      columnSource: "prematch",
      timeColumn: "observed_at",
    }))
    // Team rows hold no timestamp of their own; game_creation_at is looked up
    // from the match, and the time window is applied there (buildFactsCte).
    .with("match_teams", (): SourceKind => ({
      columnSource: "match-team",
      timeColumn: "game_creation_at",
    }))
    .with("match_team_bans", (): SourceKind => ({
      columnSource: "match-team-ban",
      timeColumn: "game_creation_at",
    }))
    // A frame's match time is looked up from its player's participant row.
    .with("timeline_frames", (): SourceKind => ({
      columnSource: "timeline-frame",
      timeColumn: "game_creation_at",
    }))
    // An event's match time comes from the match, its player from the actor.
    .with("timeline_events", (): SourceKind => ({
      columnSource: "timeline-event",
      timeColumn: "game_creation_at",
    }))
    .with("rank_current", "competition_rank", () => {
      throw new Error(`rank sources are not lake-backed: ${plan.source}`);
    })
    .exhaustive();
  if ((plan.source === "player_groups") !== forGroupFacts) {
    throw new Error(
      forGroupFacts
        ? `${plan.source} does not use the group-facts projection.`
        : "player_groups compiles through compileGroupFactsProjection.",
    );
  }
  return kind;
}

/**
 * Whether a tracked scope has anyone to join. A server with no accounts file,
 * or a set of servers tracking nobody, is the same empty answer an empty lake
 * gives.
 */
export function hasTrackedAccounts(input: {
  readonly scope: LakeQueryScope;
  readonly files: LakeFiles;
  readonly serverPeople?: readonly ServerPerson[] | undefined;
}): boolean {
  return match(input.scope.kind)
    .with("global", () => true)
    .with("guild", () => input.files.accountsParquet !== undefined)
    .with("servers", () => (input.serverPeople?.length ?? 0) > 0)
    .exhaustive();
}

/**
 * A source or filter the query's scope cannot serve. Its own class so a caller
 * that chose the scope (Explore's `servers`) can answer with a retry hint
 * rather than a bare failure; every other error stays a bug.
 */
export class ScopeRefusedError extends Error {
  override readonly name = "ScopeRefusedError";
}

/**
 * Which sources and filters a scope allows. Written as positive checks on
 * purpose: a scope kind nobody anticipated must be refused, not fall through
 * a `kind === "guild"` test and widen to the whole lake.
 */
export function enforceScopeGuards(input: {
  readonly plan: ScoutQlPlan;
  readonly scope: LakeQueryScope;
  readonly playerIds?: readonly number[] | undefined;
}): void {
  if (input.scope.kind !== "guild" && input.playerIds !== undefined) {
    throw new ScopeRefusedError(
      "playerIds scoping requires a guild scope — player ids are per-server.",
    );
  }
  // A team row has no puuid, so there is nothing to join the server's accounts
  // dimension on. Throwing is the only safe answer: degrading to global would
  // silently widen a server's scheduled report to every match in the lake.
  if (
    input.plan.source === "match_teams" ||
    input.plan.source === "match_team_bans"
  ) {
    if (input.scope.kind !== "global") {
      throw new ScopeRefusedError(
        `${input.plan.source} cannot be scoped to a server: its rows carry no player identity. Query it in global scope, or use match_participants for a server's players.`,
      );
    }
    if (input.playerIds !== undefined) {
      throw new ScopeRefusedError(
        `${input.plan.source} cannot be filtered by player.`,
      );
    }
  }
  if (
    input.plan.source === "match_pairs" &&
    input.scope.kind === "global" &&
    !namesPairSubject(input.plan)
  ) {
    throw new ScopeRefusedError(
      "match_pairs needs a player: name one with player('…'), or query a server's players. Without one it would pair every player in every recorded game.",
    );
  }
  // Rank sources threw in planSourceKind, so only the match flavor remains.
  if (input.plan.source === "competition_match_participants") {
    if (input.scope.kind !== "guild") {
      throw new ScopeRefusedError(
        "Competition reports need the competition's own server as their scope.",
      );
    }
    if (input.plan.competitionId === undefined) {
      throw new ScopeRefusedError(
        `${input.plan.source} requires a competition_id.`,
      );
    }
  }
}

/**
 * A team dimension with no rows, for a lake that has no team files yet.
 *
 * Returning no source would make the whole query empty; a participant with no
 * team row should instead read NULL team kills, which is what the LEFT JOIN
 * against this gives.
 */
const EMPTY_TEAM_DIMENSION =
  "SELECT NULL::VARCHAR AS match_id, NULL::INTEGER AS team_id, NULL::INTEGER AS champion_kills, NULL::BOOLEAN AS win WHERE false";

export type LookupSources = {
  /** The other side of a match_pairs row: every participant of the kept games. */
  pairOthers: SqlFragment | undefined;
  matchDimension: SqlFragment | undefined;
  participantDimension: SqlFragment | undefined;
  teamDimension: SqlFragment | undefined;
  frameGold: FactsCteInput["frameGold"];
  eventLookups: FactsCteInput["eventLookups"];
};

/** Which event lookups a plan names; see EVENT_LOOKUPS. */
export type EventLookupFlags = {
  firstOfKind: boolean;
  killerTeam: boolean;
  assists: boolean;
};

const EMPTY_ASSIST_ROWS =
  "SELECT NULL::VARCHAR AS event_id, NULL::VARCHAR AS role WHERE false";

/**
 * The scans an event's lookups read. Like the frame gold scan they ignore the
 * query's filter — it must not change which team won or how many players
 * assisted — and the assist scan is narrowed only to the events kept.
 */
function eventLookupSources(
  files: LakeFiles,
  flags: EventLookupFlags | undefined,
): FactsCteInput["eventLookups"] {
  if (flags === undefined) return undefined;
  return {
    firstOfKind: flags.firstOfKind,
    killerTeam: flags.killerTeam
      ? (buildMatchTeamsSource(files, frag("")) ?? frag(EMPTY_TEAM_DIMENSION))
      : undefined,
    assists: flags.assists
      ? (buildTimelineEventParticipantsSource(
          files,
          frag(EVENT_KEYS_SCAN_FILTER),
        ) ?? frag(EMPTY_ASSIST_ROWS))
      : undefined,
  };
}

/**
 * The row scans a source's looked-up facts are read from.
 *
 * `undefined` when a lookup the source cannot do without has no rows in the
 * window: a team with no match, a frame with no participant. That is the
 * same empty answer an empty lake gives.
 */
export function buildLookupSources(
  files: LakeFiles,
  kind: SourceKind,
  range: SqlFragment,
  extras: {
    teamLookup?: boolean;
    frameGold?: { team: boolean; lane: boolean } | undefined;
    /** The source scan kept only some frames, so the gold scan can follow. */
    scanFiltered?: boolean;
    eventLookups?: EventLookupFlags | undefined;
  },
): LookupSources | undefined {
  const timeline =
    kind.columnSource === "timeline-frame" ||
    kind.columnSource === "timeline-event";
  const participantDimension = timeline
    ? buildParticipantDimensionSource(files, range)
    : undefined;
  if (participantDimension === undefined && timeline) {
    return undefined;
  }
  const needsMatch =
    readsMatchDimension(kind.columnSource) ||
    kind.columnSource === "timeline-event";
  const matchDimension = needsMatch
    ? buildMatchDimensionSource(files, range)
    : undefined;
  if (matchDimension === undefined && needsMatch) {
    return undefined;
  }
  // Unrestricted: a team table is two rows a match, and the LEFT JOIN keeps
  // only the matches the participant scan already chose.
  const teamDimension =
    extras.teamLookup === true
      ? (buildMatchTeamsSource(files, frag("")) ?? frag(EMPTY_TEAM_DIMENSION))
      : undefined;
  // Not filtered by the query: the source scan may hold player('…'), and a
  // team total computed from filtered frames would sum only that player. It
  // is narrowed only to the frames the source scan kept, every player's.
  const gold = extras.frameGold;
  // Narrowing an unfiltered scan keeps every frame, and costs a second
  // full-width scan to find that out.
  const narrowed = extras.scanFiltered === true;
  const goldSource =
    gold !== undefined && (gold.team || gold.lane)
      ? buildFrameGoldSource(
          files,
          frag(narrowed ? FRAME_KEYS_SCAN_FILTER : ""),
        )
      : undefined;
  // Unfiltered but for the games the row's own side kept: a query's filters
  // describe its own player, never the one it is paired with.
  const pairOthers =
    kind.columnSource === "match-pair"
      ? buildMatchesSource(
          files,
          combineAnd([range, frag(PAIR_KEYS_SCAN_FILTER)]),
        )
      : undefined;
  return {
    pairOthers,
    matchDimension,
    participantDimension,
    teamDimension,
    frameGold:
      gold === undefined || goldSource === undefined
        ? undefined
        : { source: goldSource, narrowed, ...gold },
    eventLookups: eventLookupSources(files, extras.eventLookups),
  };
}
