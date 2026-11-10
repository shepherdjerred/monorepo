import { createHash } from "node:crypto";
import { z } from "zod";

/** Narrowing helpers for the untyped JSON inside captured bodies. */

const RecordSchema = z.record(z.string(), z.unknown());
export type JsonRecord = z.infer<typeof RecordSchema>;

export function asRecord(value: unknown): JsonRecord | null {
  if (Array.isArray(value)) return null;
  const parsed = RecordSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function asArray(value: unknown): readonly unknown[] | null {
  return Array.isArray(value) ? value : null;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** A non-negative integer count, or 0 for anything else. */
export function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : 0;
}

export function sha256(text: string | Uint8Array): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Parses JSON text, or returns null when it is not a JSON object. */
export function parseJsonObject(text: string | null): JsonRecord | null {
  if (text === null) return null;
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Parses JSON text, or returns the text itself when it is not JSON. */
export function parseJsonOrText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
