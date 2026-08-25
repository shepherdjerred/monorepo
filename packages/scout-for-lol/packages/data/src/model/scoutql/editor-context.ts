import type { IToken } from "chevrotain";
import type { ScoutQlSpan } from "#src/model/scoutql/diagnostics.ts";
import {
  decodeScoutQlIdentifier,
  tokenizeScoutQl,
} from "#src/model/scoutql/tokens.ts";

// ── Where the cursor is ──────────────────────────────────────────────────────
// Completion, signature help, and hover all need the same question answered:
// what does this offset mean? The answer comes from the token stream rather
// than a regex over the text, and from a left-to-right scan rather than the
// AST, because the interesting case is a HALF-TYPED query whose AST is missing
// exactly the clause being edited.
//
// The scan is deliberately small: clause tracking, a parenthesis stack, and
// the RENDER option position. Everything semantic (which columns exist, what
// an alias means) comes from the analysis, which the services layer on top.

export type ScoutQlClauseName =
  | "none"
  | "select"
  | "from"
  | "where"
  | "group-by"
  | "having"
  | "order-by"
  | "limit"
  | "render";

const CLAUSE_BY_TOKEN: ReadonlyMap<string, ScoutQlClauseName> = new Map([
  ["Select", "select"],
  ["From", "from"],
  ["Where", "where"],
  ["Group", "group-by"],
  ["Having", "having"],
  ["Order", "order-by"],
  ["Limit", "limit"],
  ["Render", "render"],
]);

/** One open parenthesis, and what opened it. */
export type ScoutQlParenFrame = {
  /** Offset of the `(`. */
  open: number;
  /** Lowercased callee name when the paren opened a call. */
  callee: string | undefined;
  /** Offset the callee name starts at (for signature help spans). */
  calleeStart: number | undefined;
  /** Token type name immediately before the `(` — e.g. "In", "With". */
  opener: string | undefined;
  /** Column named before an `IN (` opener, e.g. `queue IN (`. */
  openerColumn: string | undefined;
  /** Zero-based index of the argument the cursor sits in. */
  argIndex: number;
};

export type ScoutQlRenderPosition = {
  /** Nesting inside the `WITH (…)` list; 1 is the option list itself. */
  depth: number;
  /** The option name whose value is being typed, when past its `=`. */
  optionName: string | undefined;
  /** True at a place an option NAME belongs. */
  atOptionName: boolean;
};

export type ScoutQlEditorContext = {
  tokens: IToken[];
  clause: ScoutQlClauseName;
  /** The token the offset sits inside or immediately after, when identifier-ish. */
  word: { text: string; span: ScoutQlSpan } | undefined;
  /** Innermost open call at the offset. */
  call: ScoutQlParenFrame | undefined;
  /** Position within `RENDER … WITH (…)`, when the offset is inside one. */
  render: ScoutQlRenderPosition | undefined;
  /** True right after `RENDER`, where the render kind belongs. */
  atRenderKind: boolean;
  /**
   * The column whose value is being written (`queue IN (…`, `queue = …`), so
   * value completions can offer that column's vocabulary.
   */
  valueColumn: string | undefined;
};

const WORD_TOKEN_NAMES: ReadonlySet<string> = new Set([
  "Identifier",
  "QuotedIdentifier",
  "UnterminatedQuotedIdentifier",
  "StringLiteral",
  "UnterminatedStringLiteral",
]);

/** Tokens that may precede `(` as a callee — identifiers plus `group(`. */
function calleeOf(previous: IToken | undefined): string | undefined {
  if (previous === undefined) {
    return undefined;
  }
  const name = previous.tokenType.name;
  if (name === "Identifier" || name === "Group") {
    return decodeScoutQlIdentifier(previous.image);
  }
  return undefined;
}

function wordAt(
  tokens: IToken[],
  offset: number,
): { text: string; span: ScoutQlSpan } | undefined {
  for (const token of tokens) {
    const end = (token.endOffset ?? token.startOffset) + 1;
    if (
      token.startOffset < offset &&
      offset <= end &&
      WORD_TOKEN_NAMES.has(token.tokenType.name)
    ) {
      return {
        text: token.image.slice(0, offset - token.startOffset),
        span: { start: token.startOffset, end },
      };
    }
  }
  return undefined;
}

/** The token whose half-open span contains an offset, for hover-style lookups. */
export function scoutQlTokenAt(
  tokens: IToken[],
  offset: number,
): IToken | undefined {
  return tokens.find(
    (token) =>
      token.startOffset <= offset &&
      offset < (token.endOffset ?? token.startOffset) + 1,
  );
}

type ScanState = {
  clause: ScoutQlClauseName;
  stack: ScoutQlParenFrame[];
  renderSeen: boolean;
  withSeen: boolean;
  withDepth: number | undefined;
  atRenderKind: boolean;
  optionName: string | undefined;
  afterEquals: boolean;
  pendingName: string | undefined;
  valueColumn: string | undefined;
};

function openFrame(
  token: IToken,
  previous: IToken | undefined,
  beforePrevious: IToken | undefined,
  state: ScanState,
): void {
  const callee = calleeOf(previous);
  const opener = previous?.tokenType.name;
  state.stack.push({
    open: token.startOffset,
    callee,
    calleeStart: callee === undefined ? undefined : previous?.startOffset,
    opener,
    openerColumn:
      opener === "In" && beforePrevious?.tokenType.name === "Identifier"
        ? decodeScoutQlIdentifier(beforePrevious.image)
        : undefined,
    argIndex: 0,
  });
  if (state.renderSeen && state.withSeen && state.withDepth === undefined) {
    state.withDepth = state.stack.length;
  }
  // `queue IN (` puts the cursor at a value position for `queue` immediately,
  // before any comma has been typed.
  state.valueColumn = state.stack.at(-1)?.openerColumn;
}

/** Maintain the parenthesis stack for one token. */
function applyParenState(input: {
  name: string;
  token: IToken;
  previous: IToken | undefined;
  beforePrevious: IToken | undefined;
  state: ScanState;
}): void {
  const { state } = input;
  switch (input.name) {
    case "LParen": {
      openFrame(input.token, input.previous, input.beforePrevious, state);
      return;
    }
    case "RParen": {
      const closed = state.stack.pop();
      if (closed !== undefined && state.withDepth === state.stack.length + 1) {
        state.withDepth = undefined;
      }
      state.valueColumn = state.stack.at(-1)?.openerColumn;
      return;
    }
    case "Comma": {
      const frame = state.stack.at(-1);
      if (frame !== undefined) {
        frame.argIndex += 1;
      }
      return;
    }
    default: {
      return;
    }
  }
}

function applyValueColumn(
  token: IToken,
  previous: IToken | undefined,
  state: ScanState,
): void {
  const name = token.tokenType.name;
  if (name === "Equals" || name === "NotEquals") {
    state.valueColumn =
      previous?.tokenType.name === "Identifier"
        ? decodeScoutQlIdentifier(previous.image)
        : undefined;
    return;
  }
  if (name === "And" || name === "Or" || name === "Comma") {
    const frame = state.stack.at(-1);
    state.valueColumn = frame?.openerColumn;
  }
}

function applyRenderState(token: IToken, state: ScanState): void {
  const name = token.tokenType.name;
  if (name === "Render") {
    state.renderSeen = true;
    state.atRenderKind = true;
    return;
  }
  state.atRenderKind = false;
  if (!state.renderSeen) {
    return;
  }
  if (name === "With") {
    state.withSeen = true;
    return;
  }
  if (state.withDepth === undefined) {
    return;
  }
  if (name === "Identifier" && !state.afterEquals) {
    state.pendingName = decodeScoutQlIdentifier(token.image);
    return;
  }
  if (name === "Equals") {
    state.optionName = state.pendingName;
    state.afterEquals = true;
    return;
  }
  if (name === "Comma" && state.stack.length === state.withDepth) {
    state.optionName = undefined;
    state.afterEquals = false;
    state.pendingName = undefined;
  }
}

/**
 * Classify an offset in a (possibly unfinished) query.
 *
 * Note that a `FILTER (WHERE …)` body reports the `where` clause: it is a
 * row predicate, which is exactly the vocabulary a completion there wants.
 */
export function scoutQlContextAt(
  text: string,
  offset: number,
): ScoutQlEditorContext {
  const bounded = Math.max(0, Math.min(offset, text.length));
  const { tokens } = tokenizeScoutQl(text);
  const state: ScanState = {
    clause: "none",
    stack: [],
    renderSeen: false,
    withSeen: false,
    withDepth: undefined,
    atRenderKind: false,
    optionName: undefined,
    afterEquals: false,
    pendingName: undefined,
    valueColumn: undefined,
  };
  let previous: IToken | undefined;
  let beforePrevious: IToken | undefined;
  for (const token of tokens) {
    if ((token.endOffset ?? token.startOffset) + 1 > bounded) {
      break;
    }
    const name = token.tokenType.name;
    const clause = CLAUSE_BY_TOKEN.get(name);
    if (clause !== undefined) {
      state.clause = clause;
    }
    applyParenState({ name, token, previous, beforePrevious, state });
    applyValueColumn(token, previous, state);
    applyRenderState(token, state);
    beforePrevious = previous;
    previous = token;
  }
  const withDepth = state.withDepth;
  return {
    tokens,
    clause: state.clause,
    word: wordAt(tokens, bounded),
    call: state.stack.findLast((frame) => frame.callee !== undefined),
    render:
      withDepth === undefined
        ? undefined
        : {
            depth: state.stack.length - withDepth + 1,
            optionName: state.afterEquals ? state.optionName : undefined,
            atOptionName: !state.afterEquals,
          },
    atRenderKind: state.atRenderKind,
    valueColumn: state.valueColumn,
  };
}
