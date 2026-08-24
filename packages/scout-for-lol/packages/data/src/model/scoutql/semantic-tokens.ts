import type { IToken } from "chevrotain";
import { analyzeScoutQl } from "#src/model/scoutql/analyze.ts";
import {
  SCOUTQL_AGGREGATE_NAMES,
  forEachExprNode,
} from "#src/model/scoutql/analyze-expr-shared.ts";
import { scoutQlQueryExprs } from "#src/model/scoutql/query-exprs.ts";
import { scoutQlFunction } from "#src/model/scoutql/catalog-functions.ts";
import {
  SCOUTQL_KEYWORDS,
  tokenSpan,
  tokenizeScoutQl,
} from "#src/model/scoutql/tokens.ts";

// ── Semantic tokens: the ONE highlighting source ─────────────────────────────
// Every ScoutQL surface highlights from this pass — the Monaco semantic-token
// provider, the docs-site Expressive Code plugin, and the in-app <ScoutQlCode>
// component. That is the point: the hand-written Monarch grammar and the
// legacy regex highlighter each carried their own keyword list, and both had
// already drifted from the language.
//
// Two properties make it safe to render with:
//
//   1. TOTAL — the spans tile the whole input, so concatenating their text
//      reproduces the source byte for byte, including text no lexer rule
//      matched. A highlighter can emit spans and nothing else.
//   2. SEMANTIC — identifiers are upgraded through the analysis, so a resolved
//      column, an output alias, the FROM target and a known function get
//      distinct kinds instead of all being "identifier".

/**
 * Closed set of highlight kinds. Adding a member is a breaking change for
 * every surface on purpose: a `Record<ScoutQlTokenKind, …>` style map fails
 * typecheck everywhere until each surface decides how to paint the new kind.
 */
export type ScoutQlTokenKind =
  | "keyword"
  | "aggregate"
  | "function"
  | "column"
  | "alias"
  | "source"
  | "number"
  | "string"
  | "operator"
  | "comment"
  | "renderKind"
  | "renderOption"
  | "plain"
  | "invalid";

/** A span of source text with its highlight kind. */
export type ScoutQlTokenSpan = { text: string; kind: ScoutQlTokenKind };

/** The positioned form: half-open [start, start + length). */
export type ScoutQlSemanticToken = {
  start: number;
  length: number;
  kind: ScoutQlTokenKind;
};

const OPERATOR_TOKEN_NAMES: ReadonlySet<string> = new Set([
  "Comma",
  "LParen",
  "RParen",
  "DoubleColon",
  "NotEquals",
  "LtGt",
  "LessEqual",
  "GreaterEqual",
  "Less",
  "Greater",
  "Equals",
  "Plus",
  "Minus",
  "Star",
  "Slash",
  "Percent",
  "Dot",
]);

/** Lexemes that are always a mistake: unterminated literals, "…" identifiers. */
const INVALID_TOKEN_NAMES: ReadonlySet<string> = new Set([
  "UnterminatedStringLiteral",
  "QuotedIdentifier",
  "UnterminatedQuotedIdentifier",
]);

const KEYWORD_WORDS: ReadonlySet<string> = new Set(SCOUTQL_KEYWORDS);

// ── Analysis-derived upgrades ────────────────────────────────────────────────

type UpgradeMap = Map<number, ScoutQlTokenKind>;

function callKind(name: string): ScoutQlTokenKind {
  if (SCOUTQL_AGGREGATE_NAMES.has(name)) {
    return "aggregate";
  }
  return scoutQlFunction(name) === undefined ? "plain" : "function";
}

function collectUpgrades(text: string): {
  upgrades: UpgradeMap;
  names: ReadonlySet<string>;
} {
  const analysis = analyzeScoutQl(text);
  const upgrades: UpgradeMap = new Map();
  const names = new Set<string>([
    ...analysis.outputs.map((output) => output.name),
    ...analysis.groupings.map((grouping) => grouping.grouping.name),
  ]);
  const { ast } = analysis.parse;
  for (const item of ast.select?.items ?? []) {
    if (item.alias !== null) {
      names.add(item.alias);
      if (item.aliasSpan !== null) {
        upgrades.set(item.aliasSpan.start, "alias");
      }
    }
  }
  const columns = analysis.source?.columns;
  for (const expr of scoutQlQueryExprs(ast)) {
    forEachExprNode(expr, (node) => {
      if (node.kind === "call") {
        const kind = callKind(node.name);
        if (kind !== "plain") {
          upgrades.set(node.span.start, kind);
        }
        return;
      }
      if (node.kind !== "column") {
        return;
      }
      if (columns?.has(node.name) === true) {
        upgrades.set(node.span.start, "column");
      } else if (names.has(node.name)) {
        upgrades.set(node.span.start, "alias");
      }
    });
  }
  return { upgrades, names };
}

// ── Token classification ─────────────────────────────────────────────────────

function baseKind(token: IToken): ScoutQlTokenKind {
  const name = token.tokenType.name;
  if (name === "LineComment") {
    return "comment";
  }
  if (INVALID_TOKEN_NAMES.has(name)) {
    return "invalid";
  }
  if (name === "StringLiteral") {
    return "string";
  }
  if (name === "NumberLiteral" || name === "HexColor") {
    return "number";
  }
  if (OPERATOR_TOKEN_NAMES.has(name)) {
    return "operator";
  }
  if (KEYWORD_WORDS.has(token.image.toUpperCase())) {
    return "keyword";
  }
  return "plain";
}

/**
 * The three positions the expression AST cannot answer, because they are not
 * expressions: the FROM target, the RENDER kind, and RENDER option names. They
 * are read straight off the token stream so a half-typed clause still paints.
 */
type ClauseState = {
  expectSource: boolean;
  expectRenderKind: boolean;
  inRender: boolean;
  parenDepth: number;
};

function identifierKind(
  token: IToken,
  next: IToken | undefined,
  state: ClauseState,
  context: { upgrades: UpgradeMap; names: ReadonlySet<string> },
): ScoutQlTokenKind {
  if (state.expectSource) {
    state.expectSource = false;
    return "source";
  }
  if (state.expectRenderKind) {
    state.expectRenderKind = false;
    return "renderKind";
  }
  const upgrade = context.upgrades.get(token.startOffset);
  if (upgrade !== undefined) {
    return upgrade;
  }
  if (state.inRender && state.parenDepth > 0) {
    const assigned = next?.tokenType.name === "Equals";
    const known = context.names.has(token.image.toLowerCase());
    if (assigned && state.parenDepth === 1) {
      return "renderOption";
    }
    return known ? "alias" : "plain";
  }
  return "plain";
}

function advanceState(token: IToken, state: ClauseState): void {
  const name = token.tokenType.name;
  if (name === "From") {
    state.expectSource = true;
    return;
  }
  if (name === "Render") {
    state.expectRenderKind = true;
    state.inRender = true;
    return;
  }
  if (name === "LParen") {
    state.parenDepth += 1;
    return;
  }
  if (name === "RParen" && state.parenDepth > 0) {
    state.parenDepth -= 1;
  }
}

function classifyMainTokens(
  tokens: IToken[],
  context: { upgrades: UpgradeMap; names: ReadonlySet<string> },
): ScoutQlSemanticToken[] {
  const state: ClauseState = {
    expectSource: false,
    expectRenderKind: false,
    inRender: false,
    parenDepth: 0,
  };
  const classified: ScoutQlSemanticToken[] = [];
  for (const [index, token] of tokens.entries()) {
    const span = tokenSpan(token);
    const base = baseKind(token);
    const kind =
      base === "plain"
        ? identifierKind(token, tokens[index + 1], state, context)
        : base;
    advanceState(token, state);
    if (span !== null) {
      classified.push({
        start: span.start,
        length: span.end - span.start,
        kind,
      });
    }
  }
  return classified;
}

// ── Gap filling ──────────────────────────────────────────────────────────────

/**
 * Text between tokens: whitespace is `plain`, anything else is text no lexer
 * rule matched (a stray `@`, a control character) and is `invalid`. Splitting
 * the two keeps a malformed query readable instead of painting its whitespace
 * red.
 */
function fillGap(
  text: string,
  start: number,
  end: number,
  into: ScoutQlSemanticToken[],
): void {
  let index = start;
  while (index < end) {
    const isSpace = /\s/u.test(text[index] ?? "");
    let run = index + 1;
    while (run < end && /\s/u.test(text[run] ?? "") === isSpace) {
      run += 1;
    }
    into.push({
      start: index,
      length: run - index,
      kind: isSpace ? "plain" : "invalid",
    });
    index = run;
  }
}

/**
 * Every token span for a query, in source order, tiling the whole input.
 *
 * Overlapping spans cannot occur: the lexer's output is disjoint, and gaps are
 * filled from the text itself.
 */
export function scoutQlSemanticTokens(text: string): ScoutQlSemanticToken[] {
  const lex = tokenizeScoutQl(text);
  const context = collectUpgrades(text);
  const comments: ScoutQlSemanticToken[] = lex.comments.flatMap((token) => {
    const span = tokenSpan(token);
    return span === null
      ? []
      : [
          {
            start: span.start,
            length: span.end - span.start,
            kind: "comment" as const,
          },
        ];
  });
  const ordered = [
    ...classifyMainTokens(lex.tokens, context),
    ...comments,
  ].sort((left, right) => left.start - right.start);

  const tiled: ScoutQlSemanticToken[] = [];
  let cursor = 0;
  for (const token of ordered) {
    if (token.start > cursor) {
      fillGap(text, cursor, token.start, tiled);
    }
    if (token.start < cursor) {
      // Defensive: the lexer's spans are disjoint, so this is unreachable —
      // but clipping rather than skipping keeps the byte-for-byte property
      // true unconditionally, instead of true-unless-something-changed.
      const end = token.start + token.length;
      if (end > cursor) {
        tiled.push({ start: cursor, length: end - cursor, kind: token.kind });
        cursor = end;
      }
      continue;
    }
    tiled.push(token);
    cursor = token.start + token.length;
  }
  if (cursor < text.length) {
    fillGap(text, cursor, text.length, tiled);
  }
  return tiled;
}

/**
 * The same pass as text spans, for renderers that emit markup rather than
 * offsets. `spans.map((span) => span.text).join("")` is the input, exactly.
 */
export function scoutQlTokenSpans(text: string): ScoutQlTokenSpan[] {
  return scoutQlSemanticTokens(text).map((token) => ({
    text: text.slice(token.start, token.start + token.length),
    kind: token.kind,
  }));
}
