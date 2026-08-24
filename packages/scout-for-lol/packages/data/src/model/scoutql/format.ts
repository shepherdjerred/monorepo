import { match } from "ts-pattern";
import type { IToken } from "chevrotain";
import type {
  ScoutQlQueryAst,
  ScoutQlRenderListItemAst,
  ScoutQlRenderOptionAst,
  ScoutQlRenderValueAst,
} from "#src/model/scoutql/ast.ts";
import { flattenAnd } from "#src/model/scoutql/ast.ts";
import { analyzeScoutQl } from "#src/model/scoutql/analyze.ts";
import { containsErrorNode } from "#src/model/scoutql/analyze-expr-shared.ts";
import { scoutQlQueryExprs } from "#src/model/scoutql/query-exprs.ts";
import {
  FORMAT_PRECEDENCE,
  printExpr,
  printScoutQlExpr,
  quoteScoutQlString,
} from "#src/model/scoutql/format-expr.ts";

// ── formatScoutQl — the canonical printer ────────────────────────────────────
// One clause per line, multi-conjunct WHERE broken onto indented AND lines,
// SQL uppercase, and comments re-attached from the token stream.
//
// The safety rule is absolute: **a query with any error-severity diagnostic
// comes back unchanged.** A formatter that "tidies" a broken query destroys
// work — the partial AST is missing exactly the parts the author is still
// typing, so printing it would delete them. Formatting is therefore only ever
// a rewrite of a query the compiler already accepts.

const CONJUNCT_INDENT = "  ";

/** One output line plus the source offset it came from (for comment anchoring). */
type FormattedLine = { text: string; sourceStart: number };

// ── Clause printing ──────────────────────────────────────────────────────────

function selectLine(ast: ScoutQlQueryAst): FormattedLine[] {
  const select = ast.select;
  if (select === undefined) {
    return [];
  }
  const items = select.items.map((item) => {
    const expr = printScoutQlExpr(item.expr);
    return item.alias === null ? expr : `${expr} AS ${item.alias}`;
  });
  return [
    { text: `SELECT ${items.join(", ")}`, sourceStart: select.span.start },
  ];
}

function fromLine(ast: ScoutQlQueryAst): FormattedLine[] {
  const from = ast.from;
  return from === undefined
    ? []
    : [{ text: `FROM ${from.source}`, sourceStart: from.span.start }];
}

function whereLines(ast: ScoutQlQueryAst): FormattedLine[] {
  const where = ast.where;
  if (where === undefined) {
    return [];
  }
  const conjuncts = flattenAnd(where.expr);
  const [first, ...rest] = conjuncts;
  if (first === undefined) {
    return [];
  }
  // Each conjunct prints at AND precedence, so an OR inside one keeps the
  // parentheses that make it a single conjunct.
  const lines: FormattedLine[] = [
    {
      text: `WHERE ${printExpr(first, FORMAT_PRECEDENCE.and)}`,
      sourceStart: where.span.start,
    },
  ];
  for (const conjunct of rest) {
    lines.push({
      text: `${CONJUNCT_INDENT}AND ${printExpr(conjunct, FORMAT_PRECEDENCE.and)}`,
      sourceStart: conjunct.span.start,
    });
  }
  return lines;
}

function groupByLine(ast: ScoutQlQueryAst): FormattedLine[] {
  const groupBy = ast.groupBy;
  if (groupBy === undefined) {
    return [];
  }
  const body = groupBy.all
    ? "ALL"
    : groupBy.items.map((item) => printScoutQlExpr(item)).join(", ");
  return [{ text: `GROUP BY ${body}`, sourceStart: groupBy.span.start }];
}

function havingLine(ast: ScoutQlQueryAst): FormattedLine[] {
  const having = ast.having;
  return having === undefined
    ? []
    : [
        {
          text: `HAVING ${printScoutQlExpr(having.expr)}`,
          sourceStart: having.span.start,
        },
      ];
}

function orderByLine(ast: ScoutQlQueryAst): FormattedLine[] {
  const orderBy = ast.orderBy;
  if (orderBy === undefined) {
    return [];
  }
  const keys = orderBy.keys.map((key) => {
    const expr = printScoutQlExpr(key.expr);
    return key.direction === null
      ? expr
      : `${expr} ${key.direction.toUpperCase()}`;
  });
  return [
    { text: `ORDER BY ${keys.join(", ")}`, sourceStart: orderBy.span.start },
  ];
}

function limitLine(ast: ScoutQlQueryAst): FormattedLine[] {
  const limit = ast.limit;
  return limit === undefined
    ? []
    : [
        {
          text: `LIMIT ${String(limit.value)}`,
          sourceStart: limit.span.start,
        },
      ];
}

// ── RENDER ───────────────────────────────────────────────────────────────────

function renderListItem(item: ScoutQlRenderListItemAst): string {
  return match(item)
    .with({ kind: "identifier" }, (node) => node.name)
    .with({ kind: "hex-color" }, (node) => node.value)
    .with({ kind: "string" }, (node) => quoteScoutQlString(node.value))
    .with({ kind: "number" }, (node) => String(node.value))
    .with({ kind: "pair" }, (node) => {
      const value =
        node.value.kind === "identifier"
          ? node.value.name
          : quoteScoutQlString(node.value.value);
      return `${node.name} = ${value}`;
    })
    .exhaustive();
}

function renderValue(value: ScoutQlRenderValueAst): string {
  return (
    match(value)
      .with({ kind: "number" }, (node) => String(node.value))
      .with({ kind: "string" }, (node) => quoteScoutQlString(node.value))
      .with({ kind: "hex-color" }, (node) => node.value)
      // Render options read as configuration rather than SQL, so their booleans
      // stay lowercase (`smooth = true`) the way every preset writes them.
      .with({ kind: "boolean" }, (node) => (node.value ? "true" : "false"))
      .with({ kind: "identifier" }, (node) => node.name)
      .with(
        { kind: "list" },
        (node) =>
          `(${node.items.map((item) => renderListItem(item)).join(", ")})`,
      )
      .exhaustive()
  );
}

export function formatScoutQlRenderOption(
  option: ScoutQlRenderOptionAst,
): string {
  return `${option.name} = ${renderValue(option.value)}`;
}

function renderLine(ast: ScoutQlQueryAst): FormattedLine[] {
  const render = ast.render;
  if (render === undefined) {
    return [];
  }
  const options = render.options
    .map((option) => formatScoutQlRenderOption(option))
    .join(", ");
  const withClause = render.options.length === 0 ? "" : ` WITH (${options})`;
  return [
    {
      text: `RENDER ${render.kind}${withClause}`,
      sourceStart: render.span.start,
    },
  ];
}

// ── Comments ─────────────────────────────────────────────────────────────────

/**
 * Re-attach `--` comments to the clause line they followed in the source. A
 * comment lands on its own line after the last clause that began before it, so
 * a header comment stays at the top and a trailing note stays at the bottom.
 * Because the emitted comment sits between the same two clause lines, the
 * placement is a fixed point: formatting twice moves nothing.
 */
function withComments(lines: FormattedLine[], comments: IToken[]): string[] {
  const attached: string[][] = lines.map(() => []);
  const leading: string[] = [];
  for (const comment of comments) {
    const text = comment.image.trimEnd();
    let anchor = -1;
    for (const [index, line] of lines.entries()) {
      if (line.sourceStart <= comment.startOffset) {
        anchor = index;
      }
    }
    if (anchor === -1) {
      leading.push(text);
      continue;
    }
    attached[anchor]?.push(text);
  }
  const out = [...leading];
  for (const [index, line] of lines.entries()) {
    out.push(line.text, ...(attached[index] ?? []));
  }
  return out;
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Rewrite a query into its canonical form.
 *
 * Returns the input UNCHANGED when the query holds any error-severity
 * diagnostic — the formatter never gambles with text it cannot faithfully
 * reproduce.
 */
export function formatScoutQl(text: string): string {
  const analysis = analyzeScoutQl(text);
  const hasError = analysis.diagnostics.some(
    (diagnostic) => diagnostic.severity === "error",
  );
  const { ast, comments } = analysis.parse;
  if (
    hasError ||
    scoutQlQueryExprs(ast).some((expr) => containsErrorNode(expr))
  ) {
    return text;
  }
  const lines: FormattedLine[] = [
    ...selectLine(ast),
    ...fromLine(ast),
    ...whereLines(ast),
    ...groupByLine(ast),
    ...havingLine(ast),
    ...orderByLine(ast),
    ...limitLine(ast),
    ...renderLine(ast),
  ];
  return withComments(lines, comments).join("\n");
}
