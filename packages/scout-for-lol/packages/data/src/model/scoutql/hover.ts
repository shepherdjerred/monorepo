import type { IToken } from "chevrotain";
import type { ScoutQlSpan } from "#src/model/scoutql/diagnostics.ts";
import {
  analyzeScoutQl,
  type ScoutQlAnalysis,
} from "#src/model/scoutql/analyze.ts";
import {
  containsErrorNode,
  forEachExprNode,
} from "#src/model/scoutql/analyze-expr-shared.ts";
import { isChartRenderKind } from "#src/model/scoutql/analyze-render.ts";
import { scoutQlSourceCatalog } from "#src/model/scoutql/catalog-columns.ts";
import {
  scoutQlFunction,
  type ScoutQlFunctionInfo,
} from "#src/model/scoutql/catalog-functions.ts";
import {
  scoutQlContextAt,
  scoutQlTokenAt,
} from "#src/model/scoutql/editor-context.ts";
import { printScoutQlExpr } from "#src/model/scoutql/format-expr.ts";
import { scoutQlQueryExprs } from "#src/model/scoutql/query-exprs.ts";
import {
  decodeScoutQlIdentifier,
  tokenSpan,
} from "#src/model/scoutql/tokens.ts";
import { ReportOutputFormatSchema } from "#src/model/reports/report.ts";

// ── hoverScoutQl ─────────────────────────────────────────────────────────────
// Resolves the token under the cursor THROUGH the analysis rather than by
// name-matching against a static list: `champion` hovers as a dimension of the
// source this query actually reads, and `win_rate` hovers as the expression
// this query gave that name, with the display kind the renderer will use.

export type ScoutQlHover = { markdown: string; span: ScoutQlSpan };

/** Short clause docs — enough to answer "what does this word do here?". */
const KEYWORD_DOCS: ReadonlyMap<string, string> = new Map([
  [
    "Select",
    "**SELECT** — the outputs this report produces. Every computed output needs a name (`AS …`).",
  ],
  ["From", "**FROM** — the report-lake source to read. One source per query."],
  [
    "Where",
    "**WHERE** — a row filter, evaluated before aggregation. Aggregates belong in HAVING.",
  ],
  [
    "Group",
    "**GROUP BY** — the dimensions to aggregate within: a column, `DATE_TRUNC(…)`, a `FLOOR` bucket, `group(n|all)`, or `ALL`. Omit it for one grand-total row.",
  ],
  [
    "Having",
    "**HAVING** — a filter over the aggregated rows; may reference outputs by name.",
  ],
  [
    "Order",
    "**ORDER BY** — up to three sort keys naming outputs or groupings.",
  ],
  ["Limit", "**LIMIT** — how many rows to keep after ordering."],
  [
    "Render",
    "**RENDER** — how the result is displayed, e.g. `RENDER bar_chart WITH (y = win_rate)`.",
  ],
  [
    "With",
    "**WITH (…)** — render options: channel encodings plus chart settings.",
  ],
  [
    "Filter",
    "**FILTER (WHERE …)** — narrows one aggregate without narrowing the query.",
  ],
  [
    "Distinct",
    "**DISTINCT** — count unique values: `COUNT(DISTINCT champion_id)`.",
  ],
  [
    "Interval",
    "**INTERVAL** — a duration, e.g. `INTERVAL 30 DAY`. Subtract one from `CURRENT_TIMESTAMP` for a rolling window.",
  ],
  [
    "At",
    "**AT TIME ZONE** — reads a UTC timestamp in another zone, e.g. `(game_creation_at AT TIME ZONE 'America/Los_Angeles')::DATE`.",
  ],
  ["CurrentTimestamp", "**CURRENT_TIMESTAMP** — the moment the report runs."],
  ["CurrentDate", "**CURRENT_DATE** — today's date at run time."],
  [
    "Case",
    "**CASE is not supported.** Use `FILTER (WHERE …)` for conditional aggregates, or arithmetic bucketing (`FLOOR(x / 300) * 300`) for buckets.",
  ],
]);

function functionMarkdown(info: ScoutQlFunctionInfo): string {
  const signatures = info.signatures
    .map((signature) => `\`${signature.label}\``)
    .join("  \n");
  return `${signatures}\n\n${info.docMarkdown}\n\nReturns ${info.resultType}.`;
}

function columnMarkdown(
  analysis: ScoutQlAnalysis,
  name: string,
): string | undefined {
  const catalog = analysis.source;
  const column = catalog?.columns.get(name);
  if (catalog === undefined || column === undefined) {
    return undefined;
  }
  const contexts = [
    column.contexts.select ? "SELECT" : undefined,
    column.contexts.where ? "WHERE" : undefined,
    column.contexts.groupBy ? "GROUP BY" : undefined,
  ].filter((entry) => entry !== undefined);
  const role = column.virtual ? "computed dimension" : "lake column";
  return [
    `**\`${column.name}\`** — ${column.type}`,
    "",
    column.description,
    "",
    `_${catalog.id} ${role}; usable in ${contexts.join(", ")}._`,
    column.name === catalog.timeColumn
      ? "\nThis is the column time windows are recognized on."
      : "",
  ]
    .join("\n")
    .trimEnd();
}

function aliasMarkdown(
  analysis: ScoutQlAnalysis,
  name: string,
): string | undefined {
  const output = analysis.outputs.find((candidate) => candidate.name === name);
  if (output !== undefined) {
    const expression = containsErrorNode(output.ast)
      ? undefined
      : printScoutQlExpr(output.ast);
    return [
      `**\`${output.name}\`** — an output of this query`,
      ...(expression === undefined
        ? []
        : ["", "```scoutql", expression, "```"]),
      "",
      `Displays as **${output.displayKind}** (${output.type}); ${output.additive ? "additive" : "not additive"}.`,
    ].join("\n");
  }
  const grouping = analysis.groupings.find(
    (candidate) => candidate.grouping.name === name,
  );
  if (grouping === undefined) {
    return undefined;
  }
  return `**\`${name}\`** — a ${grouping.grouping.kind} grouping of this query.`;
}

function sourceMarkdown(name: string): string | undefined {
  const catalog = scoutQlSourceCatalog(name);
  if (catalog === undefined) {
    return undefined;
  }
  const time =
    catalog.timeColumn === null
      ? "No time column — this source is a snapshot of now."
      : `Time column: \`${catalog.timeColumn}\`.`;
  return [
    `**\`${catalog.id}\`** — source`,
    "",
    catalog.description,
    "",
    `${String(catalog.columns.size)} columns. ${time}`,
  ].join("\n");
}

function renderKindMarkdown(name: string): string | undefined {
  const parsed = ReportOutputFormatSchema.safeParse(name.toUpperCase());
  if (!parsed.success) {
    return undefined;
  }
  return isChartRenderKind(parsed.data)
    ? `**\`${name.toLowerCase()}\`** — a chart. Encode it with \`WITH (x = …, y = …)\` and style it with chart options.`
    : `**\`${name.toLowerCase()}\`** — a text output.`;
}

/** The function call whose name token starts exactly at this offset. */
function callNameAt(
  analysis: ScoutQlAnalysis,
  start: number,
): string | undefined {
  let found: string | undefined;
  for (const root of scoutQlQueryExprs(analysis.parse.ast)) {
    forEachExprNode(root, (node) => {
      if (node.kind === "call" && node.span.start === start) {
        found = node.name;
      }
    });
  }
  return found;
}

function identifierMarkdown(
  token: IToken,
  previous: IToken | undefined,
  analysis: ScoutQlAnalysis,
): string | undefined {
  const name = decodeScoutQlIdentifier(token.image);
  if (previous?.tokenType.name === "From") {
    return sourceMarkdown(name);
  }
  if (previous?.tokenType.name === "Render") {
    return renderKindMarkdown(name);
  }
  const callName = callNameAt(analysis, token.startOffset);
  const info = scoutQlFunction(callName ?? name);
  if (callName !== undefined && info !== undefined) {
    return functionMarkdown(info);
  }
  return (
    columnMarkdown(analysis, name) ??
    aliasMarkdown(analysis, name) ??
    (info === undefined ? undefined : functionMarkdown(info))
  );
}

/**
 * Documentation for the token at an offset, or undefined when the token
 * carries nothing worth a tooltip (punctuation, literals, unknown names).
 */
export function hoverScoutQl(
  text: string,
  offset: number,
): ScoutQlHover | undefined {
  const context = scoutQlContextAt(text, offset);
  const token = scoutQlTokenAt(context.tokens, offset);
  if (token === undefined) {
    return undefined;
  }
  const span = tokenSpan(token);
  if (span === null) {
    return undefined;
  }
  const analysis = analyzeScoutQl(text);
  const index = context.tokens.indexOf(token);
  const previous = index <= 0 ? undefined : context.tokens[index - 1];
  const keyword = KEYWORD_DOCS.get(token.tokenType.name);
  const markdown =
    keyword ??
    (token.tokenType.name === "Identifier"
      ? identifierMarkdown(token, previous, analysis)
      : undefined);
  return markdown === undefined ? undefined : { markdown, span };
}
