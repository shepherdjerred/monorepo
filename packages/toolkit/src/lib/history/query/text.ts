import { z } from "zod";
import {
  historyQueryParts,
  normalizeSearchToken,
  queryPartIndex,
  type HistoryQueryPart,
} from "./query.ts";

const RecordSchema = z.record(z.string(), z.unknown());

export function parseRecord(value: unknown): Record<string, unknown> | null {
  const parsed = RecordSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

const TEXT_KEYS = new Set([
  "text",
  "content",
  "prompt",
  "summary",
  "description",
  "message",
  "title",
  "command",
  "stdout",
  "stderr",
  "output",
  "input",
  "reason",
]);

const SENSITIVE_KEYS = new Set([
  "access_token",
  "api_key",
  "authorization",
  "cookies",
  "credentials",
  "env",
  "headers",
  "password",
  "refresh_token",
  "secret",
  "token",
  "value",
]);

export function extractText(
  value: unknown,
  depth = 0,
  maxCharacters = Number.POSITIVE_INFINITY,
): string {
  if (value == null || depth > 12 || maxCharacters <= 0) {
    return "";
  }
  if (typeof value === "string") {
    return value.slice(0, maxCharacters);
  }
  if (Array.isArray(value)) {
    const chunks: string[] = [];
    let remaining = maxCharacters;
    for (const entry of value) {
      const text = extractText(entry, depth + 1, remaining);
      if (text.length > 0) {
        chunks.push(text);
        remaining -= text.length + 1;
      }
      if (remaining <= 0) {
        break;
      }
    }
    return chunks.join("\n").slice(0, maxCharacters);
  }
  const record = parseRecord(value);
  if (record === null) {
    return "";
  }
  const chunks: string[] = [];
  let remaining = maxCharacters;
  for (const [key, child] of Object.entries(record)) {
    if (SENSITIVE_KEYS.has(key)) {
      continue;
    }
    if (TEXT_KEYS.has(key)) {
      const text = extractText(child, depth + 1, remaining);
      if (text.length > 0) {
        chunks.push(text);
        remaining -= text.length + 1;
      }
    } else if (typeof child === "object" && child !== null) {
      const nested = extractText(child, depth + 1, remaining);
      if (nested.length > 0) {
        chunks.push(nested);
        remaining -= nested.length + 1;
      }
    }
    if (remaining <= 0) {
      break;
    }
  }
  return chunks.join("\n").slice(0, maxCharacters);
}

export function cleanText(value: string): string {
  return value.replaceAll(/\s+/gu, " ").trim();
}

type LocatedToken = {
  readonly value: string;
  readonly start: number;
  readonly end: number;
};

function locatedTokens(text: string): LocatedToken[] {
  return [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((match) => ({
    value: normalizeSearchToken(match[0]),
    start: match.index,
    end: match.index + match[0].length,
  }));
}

function partRange(
  tokens: readonly LocatedToken[],
  part: HistoryQueryPart,
): { readonly start: number; readonly end: number } | null {
  const index = queryPartIndex(
    tokens.map((entry) => entry.value),
    part,
  );
  if (index < 0) {
    return null;
  }
  const first = tokens[index];
  const tokenCount = part.type === "phrase" ? part.value.split(" ").length : 1;
  const last = tokens[index + tokenCount - 1];
  if (first === undefined || last === undefined) {
    throw new Error("Located history query tokens were incomplete");
  }
  return { start: first.start, end: last.end };
}

export function excerptForQuery(
  text: string,
  query: string,
  limit = 360,
): string {
  if (limit <= 0) {
    return "";
  }
  const normalized = cleanText(text);
  if (normalized.length <= limit) {
    return normalized;
  }
  if (normalized.length === 0) {
    return "";
  }
  const tokens = locatedTokens(normalized);
  const parts = historyQueryParts(query);
  const ranges = parts.flatMap((part) => {
    const range = partRange(tokens, part);
    return range === null ? [] : [range];
  });
  if (ranges.length !== parts.length || ranges.length === 0) {
    return `${normalized.slice(0, Math.max(0, limit - 1))}…`.slice(0, limit);
  }
  const rangeStart = Math.min(...ranges.map((range) => range.start));
  const rangeEnd = Math.max(...ranges.map((range) => range.end));
  if (limit <= 2) {
    return normalized.slice(rangeStart, rangeStart + limit);
  }
  const contentBudget = Math.max(1, limit - 2);
  if (rangeEnd - rangeStart <= contentBudget) {
    const context = contentBudget - (rangeEnd - rangeStart);
    const start = Math.max(
      0,
      Math.min(
        rangeStart - Math.floor(context / 2),
        normalized.length - contentBudget,
      ),
    );
    const end = Math.min(normalized.length, start + contentBudget);
    return `${start > 0 ? "…" : ""}${normalized.slice(start, end)}${end < normalized.length ? "…" : ""}`.slice(
      0,
      limit,
    );
  }
  const separatedMatches = ranges
    .sort((left, right) => left.start - right.start)
    .map((range) => normalized.slice(range.start, range.end))
    .join(" … ");
  return separatedMatches.slice(0, limit);
}

export function parseTimestamp(value: unknown, fallback: Date): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
    return new Date(milliseconds).toISOString();
  }
  if (typeof value === "string") {
    const timestamp = Date.parse(value);
    if (!Number.isNaN(timestamp)) {
      return new Date(timestamp).toISOString();
    }
  }
  return fallback.toISOString();
}

export function parseJsonLine(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return null;
  }
}
