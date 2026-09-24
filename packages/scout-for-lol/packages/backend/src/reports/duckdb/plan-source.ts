import { match } from "ts-pattern";
import type { ScoutQlPlan } from "@scout-for-lol/data/model/scoutql/parse/plan.ts";
import type { PlanColumnSource } from "#src/reports/duckdb/column-map.ts";
import type { LakeQueryScope } from "#src/reports/duckdb/scope.ts";

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

export function enforceScopeGuards(input: {
  readonly plan: ScoutQlPlan;
  readonly scope: LakeQueryScope;
  readonly playerIds?: readonly number[] | undefined;
}): void {
  if (input.scope.kind === "global" && input.playerIds !== undefined) {
    throw new Error(
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
    if (input.scope.kind === "guild") {
      throw new Error(
        `${input.plan.source} cannot be scoped to a server: its rows carry no player identity. Query it in global scope, or use match_participants for a server's players.`,
      );
    }
    if (input.playerIds !== undefined) {
      throw new Error(`${input.plan.source} cannot be filtered by player.`);
    }
  }
  // Rank sources threw in planSourceKind, so only the match flavor remains.
  if (input.plan.source === "competition_match_participants") {
    if (input.scope.kind === "global") {
      throw new Error("Competition reports are not available in global scope.");
    }
    if (input.plan.competitionId === undefined) {
      throw new Error(`${input.plan.source} requires a competition_id.`);
    }
  }
}
