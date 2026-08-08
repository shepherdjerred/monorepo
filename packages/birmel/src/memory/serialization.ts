import { DiscordIdSchema } from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import { MemoryEmbeddingSchema } from "@shepherdjerred/birmel/memory/schemas.ts";
import { z } from "zod";

const SerializedJsonSchema = z.string().min(1);
const DiscordIdsSchema = z.array(DiscordIdSchema);

function parseJson(value: unknown): unknown {
  const serialized = SerializedJsonSchema.parse(value);
  return JSON.parse(serialized);
}

export function normalizeMemoryText(value: string): string {
  return value.normalize("NFKC").trim().replaceAll(/\s+/g, " ").toLowerCase();
}

export function normalizeDiscordIds(value: unknown): string[] {
  const ids = DiscordIdsSchema.parse(value);
  return [...new Set(ids)].sort((left, right) => left.localeCompare(right));
}

export function serializeDiscordIds(value: unknown): string {
  return JSON.stringify(normalizeDiscordIds(value));
}

export function deserializeDiscordIds(value: unknown): string[] {
  return normalizeDiscordIds(parseJson(value));
}

export function serializeEmbedding(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  const embedding = MemoryEmbeddingSchema.parse(value).map((component) =>
    Object.is(component, -0) ? 0 : component,
  );
  return JSON.stringify(embedding);
}

export function deserializeEmbedding(value: unknown): number[] | null {
  if (value === null) {
    return null;
  }
  return MemoryEmbeddingSchema.parse(parseJson(value)).map((component) =>
    Object.is(component, -0) ? 0 : component,
  );
}
