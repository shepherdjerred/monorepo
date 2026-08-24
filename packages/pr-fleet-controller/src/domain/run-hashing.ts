import { createHash } from "node:crypto";
import { JsonValueSchema, type JsonValue } from "./run-events.ts";

function canonicalJsonValue(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJsonValue(item)).join(",")}]`;
  }
  const fields = Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([key, inner]) => `${JSON.stringify(key)}:${canonicalJsonValue(inner)}`,
    );
  return `{${fields.join(",")}}`;
}

export function canonicalJson(value: unknown): string {
  return canonicalJsonValue(JsonValueSchema.parse(value));
}

export function hashEvent(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
