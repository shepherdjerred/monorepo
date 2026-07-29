import { z } from "zod";

export const KnowledgeDomainSchema = z.enum([
  "world",
  "progression",
  "species",
  "items",
  "battle",
]);

export const KnowledgeSourceSchema = z.strictObject({
  id: z.enum(["pokeemerald-wasm", "archipelago", "pokeapi", "bulbapedia"]),
  url: z.url(),
  license: z.string().min(1),
  revision: z.string().min(1),
});

export const KnowledgeRecordSchema = z.strictObject({
  id: z.string().min(1),
  domain: KnowledgeDomainSchema,
  title: z.string().min(1),
  aliases: z.array(z.string()),
  tags: z.array(z.string()),
  body: z.string().min(1),
  source: KnowledgeSourceSchema,
});

export const KnowledgeRecordsSchema = z.array(KnowledgeRecordSchema);

export type KnowledgeRecord = z.infer<typeof KnowledgeRecordSchema>;

export const SourcesSchema = z.strictObject({
  $schema: z.string().min(1),
  pokeemeraldWasm: z.strictObject({
    repository: z.url(),
    manifest: z.string().min(1),
  }),
  archipelago: z.strictObject({
    repository: z.url(),
    commit: z.string().regex(/^[0-9a-f]{40}$/),
    license: z.literal("MIT"),
    worldPath: z.string().min(1),
  }),
  pokeapi: z.strictObject({
    repository: z.url(),
    commit: z.string().regex(/^[0-9a-f]{40}$/),
    license: z.literal("BSD-3-Clause"),
    csvPath: z.string().min(1),
    versionId: z.literal(9),
    versionGroupId: z.literal(6),
    generationId: z.literal(3),
  }),
  bulbapedia: z.strictObject({
    api: z.url(),
    license: z.literal("CC BY-NC-SA 2.5"),
    licenseUrl: z.url(),
    attribution: z.string().min(1),
    pages: z
      .array(
        z.strictObject({
          title: z.string().min(1),
          revision: z.number().int().positive(),
          timestamp: z.iso.datetime(),
        }),
      )
      .length(22),
  }),
});

export type Sources = z.infer<typeof SourcesSchema>;

export function humanizeIdentifier(value: string): string {
  return value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replaceAll(/\b\w/g, (letter) => letter.toUpperCase());
}

export function compactList(values: readonly string[], limit = 30): string {
  if (values.length <= limit) {
    return values.join(", ");
  }
  return `${values.slice(0, limit).join(", ")}; plus ${String(values.length - limit)} more`;
}
