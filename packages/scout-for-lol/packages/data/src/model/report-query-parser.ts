import type { IToken, TokenType } from "chevrotain";
import type {
  ReportDiagnostic,
  ReportParseResult,
  ReportQueryAst,
  ReportQueryItem,
  ReportQuerySpan,
  ReportWhereClause,
  ReportFilterValue,
} from "#src/model/report-query-spec.ts";
import {
  And,
  By,
  Comma,
  Equals,
  From,
  GreaterEqual,
  Greater,
  Group,
  Having,
  In,
  Limit,
  LParen,
  NumberLiteral,
  Less,
  LessEqual,
  NotEqual,
  Order,
  Render,
  RParen,
  Select,
  tokenizeReportQuery,
  tokenSpan,
  Where,
} from "#src/model/report-query-lexer.ts";

const INVALID_QUERY_MESSAGE =
  "Invalid report query. Expected: SELECT <metrics> FROM <source> [WHERE queue IN (...)] GROUP BY <field> [ORDER BY <metric> DESC] [LIMIT n]";
const UNSUPPORTED_WHERE_MESSAGE = "Unsupported report WHERE clause.";

// Parses report query text into a lenient AST with source spans plus structural
// diagnostics (missing/misordered clauses, unsupported WHERE shapes). Semantic
// checks (unknown sources/metrics/queues) live in report-query-lint.ts; strict
// compilation lives in report-query-compile.ts. Never throws — the editor needs
// a best-effort parse of incomplete input.
// Locates each clause keyword's token index (or -1 when absent). The display
// clause (`… RENDER <kind> [WITH (…)]`) is the tail; keywords inside a quoted
// option value lex as a single StringLiteral, so they cannot be mistaken for a
// clause boundary.
function locateClauses(tokens: IToken[]): {
  selectIdx: number;
  fromIdx: number;
  groupIdx: number;
  whereIdx: number;
  orderIdx: number;
  havingIdx: number;
  limitIdx: number;
  renderIdx: number;
} {
  const fromIdx = indexOfType(tokens, From, 0);
  const groupIdx = indexOfGroupBy(tokens, 0);
  const afterGroup = (type: TokenType): number =>
    groupIdx === -1 ? -1 : indexOfType(tokens, type, groupIdx + 1);
  return {
    selectIdx: tokens[0]?.tokenType === Select ? 0 : -1,
    fromIdx,
    groupIdx,
    whereIdx: fromIdx === -1 ? -1 : indexOfType(tokens, Where, fromIdx),
    orderIdx:
      groupIdx === -1 ? -1 : indexOfGroupBy(tokens, groupIdx + 1, Order),
    havingIdx: afterGroup(Having),
    limitIdx: afterGroup(Limit),
    renderIdx: afterGroup(Render),
  };
}

export function parseReportQuery(text: string): ReportParseResult {
  const lex = tokenizeReportQuery(text);
  const tokens = lex.tokens;
  const diagnostics: ReportDiagnostic[] = [];

  const {
    selectIdx,
    fromIdx,
    groupIdx,
    whereIdx,
    orderIdx,
    havingIdx,
    limitIdx,
    renderIdx,
  } = locateClauses(tokens);
  const structurallyValid =
    selectIdx === 0 && fromIdx !== -1 && groupIdx !== -1 && groupIdx > fromIdx;

  if (!structurallyValid) {
    diagnostics.push({
      message: INVALID_QUERY_MESSAGE,
      severity: "error",
      span: wholeSpan(text, tokens),
    });
  }

  const whereActive =
    whereIdx !== -1 && (groupIdx === -1 || whereIdx < groupIdx);

  const selectEnd = fromIdx === -1 ? tokens.length : fromIdx;
  const select = parseItems(tokens, selectIdx + 1, selectEnd);

  const sourceEnd = whereActive
    ? whereIdx
    : groupIdx === -1
      ? tokens.length
      : groupIdx;
  const source = joinItem(
    tokens,
    fromIdx === -1 ? tokens.length : fromIdx + 1,
    sourceEnd,
  );

  const where = whereActive
    ? parseWhere(
        tokens,
        whereIdx + 1,
        groupIdx === -1 ? tokens.length : groupIdx,
        diagnostics,
      )
    : [];

  const groupByEnd = firstPositive(
    [havingIdx, orderIdx, limitIdx, renderIdx],
    tokens.length,
  );
  const groupBy =
    groupIdx === -1 ? undefined : joinItem(tokens, groupIdx + 2, groupByEnd);

  const havingEnd = firstPositive(
    [orderIdx, limitIdx, renderIdx],
    tokens.length,
  );
  const having =
    havingIdx === -1 ? undefined : joinItem(tokens, havingIdx + 1, havingEnd);

  const orderByEnd = firstPositive([limitIdx, renderIdx], tokens.length);
  const orderBy = parseOrderBy(tokens, orderIdx, orderByEnd);
  const limit = limitIdx === -1 ? undefined : tokenItem(tokens[limitIdx + 1]);
  const render = parseRenderItem(text, tokens, renderIdx);

  const ast: ReportQueryAst = {
    select,
    source,
    where,
    groupBy,
    having,
    orderBy,
    limit,
    render,
  };
  return { ast, diagnostics };
}

// Captures the raw `RENDER` clause tail (the text after the `RENDER` keyword)
// for the compiler to validate. Whitespace is collapsed but case is preserved
// so chart titles survive; the compiler's regex tolerates the single spaces.
function parseRenderItem(
  text: string,
  tokens: IToken[],
  renderIdx: number,
): ReportQueryItem | undefined {
  if (renderIdx === -1) {
    return undefined;
  }
  const renderToken = tokens[renderIdx];
  if (renderToken === undefined) {
    return undefined;
  }
  const clauseStart = (renderToken.endOffset ?? renderToken.startOffset) + 1;
  const value = text.slice(clauseStart).trim().split(/\s+/u).join(" ");
  const last = tokens.at(-1) ?? renderToken;
  return {
    value,
    span: { start: renderToken.startOffset, end: tokenSpan(last).end },
  };
}

function parseOrderBy(
  tokens: IToken[],
  orderIdx: number,
  sectionEnd: number,
): ReportQueryAst["orderBy"] {
  if (orderIdx === -1) {
    return undefined;
  }
  const metricIdx = orderIdx + 2;
  if (metricIdx >= sectionEnd) {
    return undefined;
  }
  const metric = tokenItem(tokens[metricIdx]);
  if (metric === undefined) {
    return undefined;
  }
  const directionIdx = orderIdx + 3;
  const direction =
    directionIdx < sectionEnd ? tokenItem(tokens[directionIdx]) : undefined;
  return { metric, direction };
}

function parseWhere(
  tokens: IToken[],
  start: number,
  end: number,
  diagnostics: ReportDiagnostic[],
): ReportWhereClause[] {
  const clauses: ReportWhereClause[] = [];
  let clauseStart = start;
  for (let index = start; index <= end; index++) {
    const atBoundary = index === end || tokens[index]?.tokenType === And;
    if (!atBoundary) {
      continue;
    }
    if (index > clauseStart) {
      clauses.push(parseWhereClause(tokens, clauseStart, index, diagnostics));
    }
    clauseStart = index + 1;
  }
  return clauses;
}

function parseWhereClause(
  tokens: IToken[],
  start: number,
  end: number,
  diagnostics: ReportDiagnostic[],
): ReportWhereClause {
  const slice = tokens.slice(start, end);
  const span = sliceSpan(tokens, start, end);
  const queue = matchQueueClause(slice, span);
  if (queue !== undefined) {
    return queue;
  }
  const inClause = matchInClause(slice, span);
  if (inClause !== undefined) return inClause;
  const comparison = matchComparisonClause(slice, span);
  if (comparison !== undefined) {
    return comparison;
  }
  diagnostics.push({
    message: UNSUPPORTED_WHERE_MESSAGE,
    severity: "error",
    span,
  });
  return { kind: "unsupported", text: sliceText(slice), span };
}

function matchInClause(
  slice: IToken[],
  span: ReportQuerySpan,
): ReportWhereClause | undefined {
  const field = slice[0];
  if (
    field === undefined ||
    slice[1]?.tokenType !== In ||
    slice[2]?.tokenType !== LParen ||
    slice.at(-1)?.tokenType !== RParen
  ) {
    return undefined;
  }
  const values = slice
    .slice(3, -1)
    .filter((token) => token.tokenType !== Comma)
    .map((token) => parseFilterValue(token));
  if (values.length === 0) return undefined;
  return {
    kind: "field",
    field: normalize(field.image),
    operator: "in",
    values,
    span,
  };
}

function matchQueueClause(
  slice: IToken[],
  span: ReportQuerySpan,
): ReportWhereClause | undefined {
  const first = slice[0];
  if (
    first === undefined ||
    normalize(first.image) !== "queue" ||
    slice[1]?.tokenType !== In ||
    slice[2]?.tokenType !== LParen ||
    slice.at(-1)?.tokenType !== RParen
  ) {
    return undefined;
  }
  const valueTokens = slice.slice(3, -1);
  if (valueTokens.length === 0) {
    return undefined;
  }
  const values: string[] = [];
  for (const token of valueTokens) {
    if (token.tokenType === Comma) {
      continue;
    }
    const value = normalizeQueueValue(token.image);
    if (value.length > 0) {
      values.push(value);
    }
  }
  return { kind: "queue", values, span };
}

function matchComparisonClause(
  slice: IToken[],
  span: ReportQuerySpan,
): ReportWhereClause | undefined {
  if (slice.length !== 3) {
    return undefined;
  }
  const [field, operator, value] = slice;
  if (field === undefined || operator === undefined || value === undefined) {
    return undefined;
  }
  const fieldName = normalize(field.image);
  const numeric =
    value.tokenType === NumberLiteral ? Number(value.image) : undefined;
  if (
    fieldName === "champion_id" &&
    operator.tokenType === Equals &&
    numeric !== undefined
  ) {
    return { kind: "champion_id", value: numeric, span };
  }
  if (
    fieldName === "games" &&
    operator.tokenType === GreaterEqual &&
    numeric !== undefined
  ) {
    return { kind: "min_games", value: numeric, span };
  }
  if (
    fieldName === "competition_id" &&
    operator.tokenType === Equals &&
    numeric !== undefined
  ) {
    return { kind: "competition_id", value: numeric, span };
  }
  const operatorValue = comparisonOperator(operator);
  if (operatorValue === undefined) return undefined;
  return {
    kind: "field",
    field: fieldName,
    operator: operatorValue,
    values: [parseFilterValue(value)],
    span,
  };
}

function comparisonOperator(token: IToken): string | undefined {
  if (token.tokenType === Equals) return "=";
  if (token.tokenType === NotEqual) return "!=";
  if (token.tokenType === Less) return "<";
  if (token.tokenType === LessEqual) return "<=";
  if (token.tokenType === Greater) return ">";
  if (token.tokenType === GreaterEqual) return ">=";
  return undefined;
}

function parseFilterValue(token: IToken): ReportFilterValue {
  if (token.tokenType === NumberLiteral) return Number(token.image);
  const value = normalizeQueueValue(token.image);
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

// ── token helpers ────────────────────────────────────────────────────────────

function indexOfType(tokens: IToken[], type: TokenType, from: number): number {
  for (let index = Math.max(from, 0); index < tokens.length; index++) {
    if (tokens[index]?.tokenType === type) {
      return index;
    }
  }
  return -1;
}

// Finds a two-word keyword pair (e.g. GROUP BY / ORDER BY): the lead keyword
// immediately followed by BY.
function indexOfGroupBy(
  tokens: IToken[],
  from: number,
  lead: TokenType = Group,
): number {
  for (let index = Math.max(from, 0); index < tokens.length - 1; index++) {
    if (
      tokens[index]?.tokenType === lead &&
      tokens[index + 1]?.tokenType === By
    ) {
      return index;
    }
  }
  return -1;
}

function firstPositive(candidates: number[], fallback: number): number {
  const present = candidates.filter((value) => value !== -1);
  return present.length === 0 ? fallback : Math.min(...present);
}

function parseItems(
  tokens: IToken[],
  start: number,
  end: number,
): ReportQueryItem[] {
  const items: ReportQueryItem[] = [];
  let itemStart = start;
  let depth = 0;
  for (let index = start; index <= end; index++) {
    const token = tokens[index];
    if (token?.tokenType === LParen) depth++;
    if (token?.tokenType === RParen) depth--;
    const atBoundary =
      index === end || (token?.tokenType === Comma && depth === 0);
    if (!atBoundary) {
      continue;
    }
    const item = joinItem(tokens, itemStart, index);
    if (item !== undefined) {
      items.push(item);
    }
    itemStart = index + 1;
  }
  return items;
}

// Joins a token range into a single lowercased item with a covering span,
// mirroring the original parser's whitespace-collapsing normalization.
function joinItem(
  tokens: IToken[],
  start: number,
  end: number,
): ReportQueryItem | undefined {
  if (start >= end || start < 0) {
    return undefined;
  }
  const slice = tokens.slice(start, end);
  if (slice.length === 0) {
    return undefined;
  }
  return { value: sliceText(slice), span: sliceSpan(tokens, start, end) };
}

function tokenItem(token: IToken | undefined): ReportQueryItem | undefined {
  if (token === undefined) {
    return undefined;
  }
  return { value: normalize(token.image), span: tokenSpan(token) };
}

function sliceText(slice: IToken[]): string {
  return normalize(slice.map((token) => token.image).join(" "));
}

function sliceSpan(
  tokens: IToken[],
  start: number,
  end: number,
): ReportQuerySpan {
  const first = tokens[start];
  const last = tokens[end - 1];
  if (first === undefined || last === undefined) {
    return { start: 0, end: 0 };
  }
  return { start: first.startOffset, end: tokenSpan(last).end };
}

function wholeSpan(text: string, tokens: IToken[]): ReportQuerySpan {
  const first = tokens[0];
  const last = tokens.at(-1);
  if (first === undefined || last === undefined) {
    return { start: 0, end: text.length };
  }
  return { start: first.startOffset, end: tokenSpan(last).end };
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeQueueValue(value: string): string {
  const normalized = normalize(value);
  const first = normalized.at(0);
  const last = normalized.at(-1);
  if (
    normalized.length >= 2 &&
    ((first === "'" && last === "'") || (first === '"' && last === '"'))
  ) {
    return normalized.slice(1, -1);
  }
  return normalized;
}

export { INVALID_QUERY_MESSAGE, UNSUPPORTED_WHERE_MESSAGE };
