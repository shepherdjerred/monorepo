import { z } from "zod";
import {
  CatalogIdentitySchema,
  CatalogReferenceSchema,
} from "#shared/acquisition/catalog.ts";

/** Canonical-root IDs only: episode-local IDs must never be treated as show IDs. */
export function canonicalReferences(root: {
  kind: string;
  tmdbId: number | null;
  externalIds: unknown;
}) {
  const kind = z.enum(["movie", "series"]).parse(root.kind);
  const ids = z.record(z.string(), z.json()).parse(root.externalIds);
  const catalog =
    ids["catalogIdentity"] === undefined
      ? null
      : CatalogIdentitySchema.parse(ids["catalogIdentity"]);
  const references = [
    ...(catalog?.references ?? []),
    ...(root.tmdbId === null
      ? []
      : [
          CatalogReferenceSchema.parse({
            kind,
            namespace: "tmdb",
            value: String(root.tmdbId),
          }),
        ]),
  ];
  for (const namespace of ["tmdb", "imdb", "tvdb"] as const) {
    const raw = ids[namespace];
    if (raw === undefined || raw === null) continue;
    const value = String(
      z.union([z.string(), z.number().int().positive()]).parse(raw),
    );
    references.push(CatalogReferenceSchema.parse({ kind, namespace, value }));
  }
  if (
    references.some(
      (reference) =>
        reference.kind !== kind ||
        references.some(
          (other) =>
            other.namespace === reference.namespace &&
            other.value !== reference.value,
        ),
    )
  )
    throw new Error("Canonical catalog identifier association is corrupt");
  return {
    references: [
      ...new Map(
        references.map((reference) => [reference.namespace, reference]),
      ).values(),
    ].sort((a, b) => a.namespace.localeCompare(b.namespace)),
    aliases: [
      ...(catalog?.aliases.map((alias) => alias.title) ?? []),
      ...(catalog?.originalTitle == null ? [] : [catalog.originalTitle]),
    ],
  };
}
