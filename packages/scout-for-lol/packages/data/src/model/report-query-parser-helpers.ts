import type { IToken, TokenType } from "chevrotain";
import type {
  ReportQueryItem,
  ReportQuerySpan,
} from "#src/model/report-query-spec.ts";
import {
  By,
  Comma,
  Group,
  LParen,
  RParen,
  tokenSpan,
} from "#src/model/report-query-lexer.ts";

// ── token helpers ────────────────────────────────────────────────────────────

export function indexOfType(
  tokens: IToken[],
  type: TokenType,
  from: number,
): number {
  for (let index = Math.max(from, 0); index < tokens.length; index++) {
    if (tokens[index]?.tokenType === type) {
      return index;
    }
  }
  return -1;
}

// Finds a two-word keyword pair (e.g. GROUP BY / ORDER BY): the lead keyword
// immediately followed by BY.
export function indexOfGroupBy(
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

export function firstPositive(candidates: number[], fallback: number): number {
  const present = candidates.filter((value) => value !== -1);
  return present.length === 0 ? fallback : Math.min(...present);
}

export function parseItems(
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
export function joinItem(
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

export function tokenItem(
  token: IToken | undefined,
): ReportQueryItem | undefined {
  if (token === undefined) {
    return undefined;
  }
  return { value: normalize(token.image), span: tokenSpan(token) };
}

export function sliceText(slice: IToken[]): string {
  return normalize(slice.map((token) => token.image).join(" "));
}

export function sliceSpan(
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

export function wholeSpan(text: string, tokens: IToken[]): ReportQuerySpan {
  const first = tokens[0];
  const last = tokens.at(-1);
  if (first === undefined || last === undefined) {
    return { start: 0, end: text.length };
  }
  return { start: first.startOffset, end: tokenSpan(last).end };
}

export function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeQueueValue(value: string): string {
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
