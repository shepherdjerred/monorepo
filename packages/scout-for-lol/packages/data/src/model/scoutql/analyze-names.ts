import type { ScoutQlExprAst } from "#src/model/scoutql/ast.ts";
import { ScoutQlOutputNameSchema } from "#src/model/scoutql/expression.ts";

// ── Derived output names ─────────────────────────────────────────────────────
// Used only by quick fixes ("name this output AS …"), never silently applied:
// an unnamed computed output is an error, and this supplies the repair the
// editor offers. The name is a suggestion, so a rough-but-readable derivation
// beats an exhaustive one.

function sanitize(candidate: string): string {
  const cleaned = candidate
    .toLowerCase()
    .replaceAll(/[^a-z0-9_]+/gu, "_")
    .replaceAll(/^_+|_+$/gu, "")
    .slice(0, 64);
  return ScoutQlOutputNameSchema.safeParse(cleaned).success ? cleaned : "value";
}

/** The column an aggregate is "about", looking through casts and rounding. */
function subjectName(expr: ScoutQlExprAst): string | undefined {
  if (expr.kind === "column") {
    return expr.name;
  }
  if (expr.kind === "cast") {
    return subjectName(expr.operand);
  }
  if (expr.kind === "binary") {
    return subjectName(expr.left) ?? subjectName(expr.right);
  }
  if (expr.kind === "call" && expr.args.length > 0) {
    const [first] = expr.args;
    return first === undefined ? undefined : subjectName(first);
  }
  return undefined;
}

export function deriveOutputName(expr: ScoutQlExprAst): string {
  if (expr.kind === "column") {
    return sanitize(expr.name);
  }
  if (expr.kind !== "call") {
    const subject = subjectName(expr);
    return sanitize(subject ?? "value");
  }
  if (expr.name === "count" && expr.star) {
    return "games";
  }
  if (expr.name === "date_trunc") {
    const [part] = expr.args;
    return sanitize(part?.kind === "string" ? part.value : "bucket");
  }
  if (expr.name === "kda") {
    return "kda";
  }
  const subject = subjectName(expr);
  if (subject === undefined) {
    return sanitize(expr.name);
  }
  if (expr.name === "per_minute") {
    return sanitize(`${subject}_per_minute`);
  }
  return sanitize(`${expr.name}_${subject}`);
}
