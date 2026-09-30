import { unconvertible } from "./scoutql-v2-unconvertible.ts";

// ── Route B, half two: the RENDER clause ─────────────────────────────────────
// v2 keeps the legacy RENDER grammar almost verbatim — same kind tokens, same
// option names — so this rewrites only the three things that actually moved:
//
//   1. Channel encodings named the grouping `label` (or `pair`). v2 channels
//      name an output or a GROUPING, and the grouping has a real name now.
//   2. Legacy accepted double-quoted option strings. v2 is DuckDB: double
//      quotes are identifiers, single quotes are strings with '' escaping.
//   3. `ANALYZE … COMPARE TO PREVIOUS PERIOD` becomes the render option
//      `compare = previous_period`.
//
// Everything else is passed through unchanged, so a title, palette, or colour
// list survives exactly as its author wrote it.

const CHANNEL_OPTIONS = new Set(["x", "y", "series", "size", "value"]);
const STRING_OPTIONS = new Set(["title", "subtitle", "x_axis", "y_axis"]);

type RenderRewriteInput = {
  /** The clause tail after the RENDER keyword, whitespace-collapsed. */
  clause: string;
  /** Name of the sole grouping, for channels that said `label`. */
  groupingName: string | undefined;
  /** Whether the legacy plan's render spec is a chart kind. */
  isChart: boolean;
  /** Add `compare = previous_period` (from COMPARE TO PREVIOUS PERIOD). */
  addCompare: boolean;
};

type RenderPair = { key: string; value: string };

/**
 * Split a `WITH (...)` body into `key = value` pairs.
 *
 * Quote- and paren-aware because both appear inside values: `title = 'a, b'`
 * and `y = (wins, losses)` each contain a comma that is not a separator.
 */
function splitPairs(body: string): RenderPair[] {
  const segments: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | undefined;
  for (let index = 0; index < body.length; index++) {
    const char = body[index];
    if (char === "'" || char === '"') {
      quote = quote === undefined ? char : quote === char ? undefined : quote;
      continue;
    }
    if (quote !== undefined) continue;
    if (char === "(") depth++;
    if (char === ")") depth--;
    if (char === "," && depth === 0) {
      segments.push(body.slice(start, index));
      start = index + 1;
    }
  }
  segments.push(body.slice(start));
  return segments
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      const equals = segment.indexOf("=");
      if (equals === -1) {
        return unconvertible(`RENDER option "${segment}" has no value.`);
      }
      return {
        key: segment.slice(0, equals).trim().toLowerCase(),
        value: segment.slice(equals + 1).trim(),
      };
    });
}

function quoteString(value: string): string {
  const inner =
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
      ? value.slice(1, -1)
      : value;
  return `'${inner.replaceAll("'", "''")}'`;
}

function rewriteChannelName(
  name: string,
  groupingName: string | undefined,
): string {
  const token = name.trim().toLowerCase();
  if (token !== "label" && token !== "pair") {
    return token;
  }
  if (token === "pair") {
    // `pair` was the legacy alias for a 2-member teammate group; the v2
    // grouping is named `group` whatever its size.
    return "group";
  }
  if (groupingName === undefined) {
    return unconvertible(
      "RENDER references the `label` column, which v2 replaces with the grouping's own name — this query has no single grouping to rename it to.",
    );
  }
  return groupingName;
}

function rewriteChannelValue(
  value: string,
  groupingName: string | undefined,
): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("(") || !trimmed.endsWith(")")) {
    return rewriteChannelName(trimmed, groupingName);
  }
  const inner = trimmed
    .slice(1, -1)
    .split(",")
    .map((name) => rewriteChannelName(name, groupingName));
  return `(${inner.join(", ")})`;
}

function rewritePair(pair: RenderPair, input: RenderRewriteInput): RenderPair {
  if (CHANNEL_OPTIONS.has(pair.key)) {
    return {
      key: pair.key,
      value: rewriteChannelValue(pair.value, input.groupingName),
    };
  }
  if (STRING_OPTIONS.has(pair.key)) {
    return { key: pair.key, value: quoteString(pair.value) };
  }
  return pair;
}

const WITH_PATTERN = /^with\s*\((?<body>[\s\S]*)\)$/iu;

/** Rewrite the tail of a legacy RENDER clause into its v2 spelling. */
export function rewriteRenderClause(input: RenderRewriteInput): string {
  const clause = input.clause.trim();
  const firstSpace = clause.indexOf(" ");
  const kind = (firstSpace === -1 ? clause : clause.slice(0, firstSpace))
    .trim()
    .toLowerCase();
  const withText = firstSpace === -1 ? "" : clause.slice(firstSpace + 1).trim();
  if (input.addCompare && !input.isChart) {
    return unconvertible(
      `COMPARE TO PREVIOUS PERIOD became the chart option \`compare = previous_period\`, which RENDER ${kind} does not accept. Choose a chart render kind, or drop the comparison.`,
    );
  }
  const body = WITH_PATTERN.exec(withText)?.groups?.["body"];
  if (body === undefined && withText.length > 0) {
    return unconvertible(`RENDER ${kind} has an unreadable WITH clause.`);
  }
  const pairs =
    body === undefined
      ? []
      : splitPairs(body).map((pair) => rewritePair(pair, input));
  if (input.addCompare) {
    pairs.push({ key: "compare", value: "previous_period" });
  }
  if (pairs.length === 0) {
    return kind;
  }
  const rendered = pairs
    .map((pair) => `${pair.key} = ${pair.value}`)
    .join(", ");
  return `${kind} WITH (${rendered})`;
}
