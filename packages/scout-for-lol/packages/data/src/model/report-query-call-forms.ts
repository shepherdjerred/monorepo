import type { IToken } from "chevrotain";
import type {
  ReportQuerySpan,
  ReportWhereClause,
} from "#src/model/report-query-spec.ts";
import {
  Equals,
  LParen,
  RParen,
  StringLiteral,
} from "#src/model/report-query-lexer.ts";
import { normalize } from "#src/model/report-query-parser-helpers.ts";
import { parseReportStringLiteral } from "#src/model/report-query-string-literal.ts";

/**
 * The two `field = name('…')` call forms.
 *
 * Both keep the author's string in the AST and are re-printed verbatim by the
 * formatter, so the identifier a reader sees is the one they wrote. For
 * `champion()` that is a convenience; for `player()` it is the whole point.
 * Stored Explore query text is served to anonymous holders of a share link,
 * baked into markdown exports, and replayed into the model's context on every
 * follow-up — so a resolved PUUID must never reach it. Resolution happens in
 * the backend at execution time.
 *
 * Each matcher is a rigid six-token shape and returns undefined on any
 * mismatch, so the caller falls through to the generic comparison path.
 */

function matchCallForm(
  slice: IToken[],
  field: string,
  callee: string,
): string | undefined {
  if (
    normalize(slice[0]?.image ?? "") !== field ||
    slice[1]?.tokenType !== Equals ||
    normalize(slice[2]?.image ?? "") !== callee ||
    slice[3]?.tokenType !== LParen ||
    slice[4]?.tokenType !== StringLiteral ||
    slice[5]?.tokenType !== RParen ||
    slice.length !== 6
  ) {
    return undefined;
  }
  return parseReportStringLiteral(slice[4].image);
}

export function matchChampionClause(
  slice: IToken[],
  span: ReportQuerySpan,
): ReportWhereClause | undefined {
  const name = matchCallForm(slice, "champion_id", "champion");
  return name === undefined ? undefined : { kind: "champion", name, span };
}

export function matchPlayerClause(
  slice: IToken[],
  span: ReportQuerySpan,
): ReportWhereClause | undefined {
  const name = matchCallForm(slice, "player", "player");
  return name === undefined ? undefined : { kind: "player_ref", name, span };
}
