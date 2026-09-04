import { z } from "zod";
import { DareDomainColumnSchema, dareDomainIssue } from "@scout-for-lol/data";
import { relationalScoutQlStatementFromImmutableAst } from "#src/reports/duckdb/relational-scoutql.ts";
import {
  relationalScoutQlArrayValue as arrayValue,
  relationalScoutQlObjectValue as objectValue,
  relationalScoutQlStringValue as stringValue,
  type RelationalScoutQlJsonValue as JsonValue,
} from "#src/reports/duckdb/relational-scoutql-json.ts";

/**
 * Domain validation for Dare v3 contracts.
 *
 * v3 froze the SQL instead of a typed plan, so there is no `threshold` field to
 * type and `darePlanSemanticIssues` never runs for it. A comparison against an
 * impossible value — `team_position = 'MID'` when Riot writes `MIDDLE` — is just
 * a literal that matches no row, which reads as an honestly-lost dare rather
 * than a broken one. This walks the frozen AST and applies the same domain table
 * the v2 contract schema uses, so the two contract shapes cannot disagree about
 * which values exist.
 */

/** The literal kinds a comparison threshold may hold. */
const AstLiteralSchema = z.union([z.string(), z.number(), z.boolean()]);

/** The unqualified column a COLUMN_REF names, or null for any other node. */
function columnName(value: JsonValue | undefined): string | null {
  const object = objectValue(value);
  if (object === null || stringValue(object["class"]) !== "COLUMN_REF") {
    return null;
  }
  const names = arrayValue(object["column_names"]);
  const last = names.at(-1);
  return last === undefined ? null : stringValue(last);
}

/**
 * A plain literal's value, or null when the node is not one. Casts are unwrapped
 * because DuckDB wraps some constants; anything else (a column, an expression)
 * has no domain to check.
 */
function literalValue(
  value: JsonValue | undefined,
): string | number | boolean | null {
  const object = objectValue(value);
  if (object === null) return null;
  if (stringValue(object["class"]) === "CAST") {
    return literalValue(object["child"]);
  }
  if (stringValue(object["class"]) !== "CONSTANT") return null;
  const constant = objectValue(object["value"]);
  if (constant === null || constant["is_null"] === true) return null;
  const literal = AstLiteralSchema.safeParse(constant["value"]);
  return literal.success ? literal.data : null;
}

/** Record an issue when `column` has a closed domain that `literal` violates. */
function checkPair(
  columnValue: JsonValue | undefined,
  literalNode: JsonValue | undefined,
  issues: string[],
): void {
  const name = columnName(columnValue);
  if (name === null) return;
  const column = DareDomainColumnSchema.safeParse(name);
  if (!column.success) return;
  const literal = literalValue(literalNode);
  // A comparison against another column or a computed expression carries no
  // literal to validate; only a written-down value can be out of domain.
  if (literal === null) return;
  const issue = dareDomainIssue(column.data, literal);
  if (issue !== null) issues.push(issue);
}

function inspectNode(
  object: Record<string, JsonValue>,
  issues: string[],
): void {
  const className = stringValue(object["class"]);
  if (className === "COMPARISON") {
    // Either operand may hold the column: `p0.team_position = 'MID'` and
    // `'MID' = p0.team_position` are the same mistake.
    checkPair(object["left"], object["right"], issues);
    checkPair(object["right"], object["left"], issues);
    return;
  }
  if (
    className === "OPERATOR" &&
    stringValue(object["type"]) === "COMPARE_IN"
  ) {
    const children = arrayValue(object["children"]);
    const [column, ...values] = children;
    for (const value of values) checkPair(column, value, issues);
  }
}

function collectDomainIssues(value: JsonValue, issues: string[]): void {
  if (Array.isArray(value)) {
    for (const child of value) collectDomainIssues(child, issues);
    return;
  }
  const object = objectValue(value);
  if (object === null) return;
  inspectNode(object, issues);
  for (const child of Object.values(object)) {
    collectDomainIssues(child, issues);
  }
}

/**
 * Every domain violation written into a Dare v3 contract's frozen SQL.
 *
 * Deduplicated because one authoring mistake can appear in several CTEs of the
 * generated query, and repeating the same sentence teaches the author nothing.
 */
export function dareSqlV3DomainIssues(immutableAst: string): string[] {
  const issues: string[] = [];
  collectDomainIssues(
    relationalScoutQlStatementFromImmutableAst(immutableAst),
    issues,
  );
  return [...new Set(issues)];
}
