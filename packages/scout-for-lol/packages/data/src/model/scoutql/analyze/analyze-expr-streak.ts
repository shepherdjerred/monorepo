import type { ScoutQlExprAst } from "#src/model/scoutql/parse/ast.ts";
import type { ScoutQlStreakMode } from "#src/model/scoutql/parse/expression.ts";
import {
  emitDiagnostic,
  type ExprTypingContext,
  type ScoutQlExprType,
} from "#src/model/scoutql/analyze/analyze-expr-shared.ts";

// ── Streak aggregates ────────────────────────────────────────────────────────
// LONGEST_STREAK / CURRENT_STREAK read a player's games in order, which needs
// `game_end_at` and one row per player per game: only the finished-match
// participant sources have both. The condition is per game, so it must be
// boolean. WHERE decides which games count; a FILTER cannot, because a game
// it left out would still sit between two others and break their run.

type CallNode = Extract<ScoutQlExprAst, { kind: "call" }>;

const STREAK_MODE_BY_NAME: ReadonlyMap<string, ScoutQlStreakMode> = new Map([
  ["longest_streak", "longest"],
  ["current_streak", "current"],
]);

const STREAK_SOURCES: ReadonlySet<string> = new Set([
  "match_participants",
  "competition_match_participants",
]);

/** The streak mode a function name denotes, if it is a streak. */
export function streakMode(name: string): ScoutQlStreakMode | undefined {
  return STREAK_MODE_BY_NAME.get(name);
}

/**
 * Why a function refuses FILTER. A streak's refusal points at WHERE, the
 * clause that does what the FILTER was reaching for.
 */
export function filterRefusal(name: string): string {
  return streakMode(name) === undefined
    ? "FILTER (WHERE …) only applies to aggregate functions."
    : `${name.toUpperCase()} takes no FILTER: a game FILTER left out would still break the run. Put the condition in WHERE to skip those games instead.`;
}

export function typeStreakCall(
  node: CallNode,
  arg: ScoutQlExprAst | undefined,
  argType: ScoutQlExprType,
  ctx: ExprTypingContext,
): void {
  const name = node.name.toUpperCase();
  if (arg !== undefined && argType !== "unknown" && argType !== "boolean") {
    emitDiagnostic(ctx.diagnostics, {
      code: "type-mismatch",
      message: `${name} needs a condition that is true or false per game, such as win or kills >= 10; got ${argType}.`,
      span: arg.span,
    });
  }
  const source = ctx.catalog?.id;
  if (source !== undefined && !STREAK_SOURCES.has(source)) {
    emitDiagnostic(ctx.diagnostics, {
      code: "source-column-context",
      message: `${name} reads each player's games in order, which only match_participants can do; ${source} cannot.`,
      span: node.span,
    });
  }
}
