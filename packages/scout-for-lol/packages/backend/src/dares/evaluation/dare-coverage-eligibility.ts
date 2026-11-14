import {
  dareSqlColumnReadsLakeRelation,
  dareSqlQueryScope,
  type DareSqlScope,
} from "#src/dares/sql/dare-sql-column-origin.ts";
import {
  relationalScoutQlArrayValue as arrayValue,
  relationalScoutQlObjectValue as objectValue,
  relationalScoutQlStringValue as stringValue,
  type RelationalScoutQlJsonValue as JsonValue,
} from "#src/reports/duckdb/relational-scoutql-json.ts";
import { relationalScoutQlStatementFromImmutableAst } from "#src/reports/duckdb/relational-scoutql.ts";
import {
  END_OF_GAME_NULLABLE_LAKE_COLUMNS,
  matchCoverageOf,
  type CanonicalMatch,
  type DareContract,
} from "@scout-for-lol/data";

/**
 * Whether a Dare can be judged on a game, given how much of the game Scout
 * has. A game known only from the end-of-game block states no timeline and
 * leaves some lake columns NULL, so a contract that reads one has no honest
 * answer for that game: it is ineligible, never failed. The game is simply not
 * one the Dare counts.
 */
export type DareCoverageEligibility =
  | { readonly kind: "eligible" }
  | {
      readonly kind: "ineligible";
      readonly reason: "timeline_relation" | "unstated_column";
      /** The relations and columns the contract reads that the game lacks. */
      readonly references: readonly string[];
    };

type EligibilityContract = Pick<DareContract, "facts" | "immutableAst">;

const NULLABLE_COLUMNS = new Set(END_OF_GAME_NULLABLE_LAKE_COLUMNS);

/** Relations an end-of-game game has no rows for: the timeline, and the bans. */
function lacksRows(source: string): boolean {
  return source.startsWith("timeline_") || source === "match_team_bans";
}

function collectColumnReferences(
  value: JsonValue,
  scope: DareSqlScope | null,
  references: Set<string>,
): void {
  if (Array.isArray(value)) {
    for (const child of value) {
      collectColumnReferences(child, scope, references);
    }
    return;
  }
  const object = objectValue(value);
  if (object === null) return;
  const inner =
    stringValue(object["type"]) === "SELECT_NODE"
      ? dareSqlQueryScope(object, scope)
      : scope;
  if (inner !== null && stringValue(object["class"]) === "COLUMN_REF") {
    const names = arrayValue(object["column_names"]);
    const name = stringValue(names.at(-1))?.toLowerCase();
    // Only a read of the lake relation itself counts. A CTE's column that
    // shares a lake name, or renames another column to it, is not the lake's;
    // what the CTE reads is audited in its own body.
    if (
      name !== undefined &&
      NULLABLE_COLUMNS.has(name) &&
      dareSqlColumnReadsLakeRelation(inner, names)
    ) {
      references.add(name);
    }
  }
  for (const child of Object.values(object)) {
    collectColumnReferences(child, inner, references);
  }
}

/** The end-of-game NULL columns a frozen Dare contract reads. */
function nullableColumnReferences(immutableAst: string): string[] {
  const references = new Set<string>();
  collectColumnReferences(
    relationalScoutQlStatementFromImmutableAst(immutableAst),
    null,
    references,
  );
  return [...references].toSorted();
}

/**
 * The contract's reads checked against what an end-of-game game states.
 * Anything it reads that the block lacks makes the game ineligible.
 */
export function dareEndOfGameEligibility(
  contract: EligibilityContract,
): DareCoverageEligibility {
  const relations = contract.facts.physicalSources.filter((source) =>
    lacksRows(source),
  );
  if (relations.length > 0) {
    return {
      kind: "ineligible",
      reason: "timeline_relation",
      references: [...new Set(relations)].toSorted(),
    };
  }
  const columns = nullableColumnReferences(contract.immutableAst);
  return columns.length === 0
    ? { kind: "eligible" }
    : { kind: "ineligible", reason: "unstated_column", references: columns };
}

/** Whether a contract can be judged on this game, by the game's coverage. */
export function dareCoverageEligibility(
  match: CanonicalMatch,
  contract: EligibilityContract,
): DareCoverageEligibility {
  return matchCoverageOf(match.metadata) === "complete"
    ? { kind: "eligible" }
    : dareEndOfGameEligibility(contract);
}
