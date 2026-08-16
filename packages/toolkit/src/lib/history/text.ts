import { z } from "zod";

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

export function extractText(value: unknown, depth = 0): string {
  if (depth > 12 || value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => extractText(entry, depth + 1))
      .filter((entry) => entry.length > 0)
      .join("\n");
  }
  const record = parseRecord(value);
  if (record === null) {
    return "";
  }
  const chunks: string[] = [];
  for (const [key, child] of Object.entries(record)) {
    if (SENSITIVE_KEYS.has(key)) {
      continue;
    }
    if (TEXT_KEYS.has(key)) {
      const text = extractText(child, depth + 1);
      if (text.length > 0) {
        chunks.push(text);
      }
    } else if (typeof child === "object" && child !== null) {
      const nested = extractText(child, depth + 1);
      if (nested.length > 0) {
        chunks.push(nested);
      }
    }
  }
  return chunks.join("\n");
}

export function cleanText(value: string): string {
  return value.replaceAll(/\s+/gu, " ").trim();
}

export function excerptForQuery(text: string, query: string): string {
  const normalized = cleanText(text);
  if (normalized.length === 0) {
    return "";
  }
  const terms = query
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter((term) => term.length >= 2);
  const lower = normalized.toLocaleLowerCase();
  const offset = terms
    .map((term) => lower.indexOf(term))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  const start = Math.max(0, (offset ?? 0) - 100);
  const end = Math.min(normalized.length, start + 360);
  return `${start > 0 ? "…" : ""}${normalized.slice(start, end)}${end < normalized.length ? "…" : ""}`;
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
