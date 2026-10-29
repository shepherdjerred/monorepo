import { z } from "zod";
import {
  CatalogReferenceSchema,
  type CatalogReference,
} from "#shared/acquisition/catalog.ts";
import { EpisodeCoordinateSchema } from "#shared/acquisition/coordinates.ts";
import { PublicationHashSchema } from "#shared/publication-proof/effects.ts";
import { PlexBindingScopeSchema } from "./contract.ts";

const Target = z.strictObject({
  scope: PlexBindingScopeSchema,
  canonicalRootId: z.uuid(),
  references: z.array(CatalogReferenceSchema).min(1).max(3),
  canonicalIdentityHash: PublicationHashSchema,
  numberingHash: PublicationHashSchema,
});
export const PlexCanonicalTargetSchema = z.discriminatedUnion("kind", [
  Target.extend({ kind: z.literal("movie") }),
  Target.extend({
    kind: z.literal("episode"),
    coordinate: EpisodeCoordinateSchema,
  }),
]);
export type PlexCanonicalTarget = z.infer<typeof PlexCanonicalTargetSchema>;

/** A matching provider cannot excuse a conflicting identifier from another known provider. */
export function matchesReferences(
  guids: readonly string[],
  references: readonly CatalogReference[],
): boolean {
  let matched = false;
  for (const reference of references) {
    const prefix = `${reference.namespace}://`;
    const observed = guids.filter((value) => value.startsWith(prefix));
    if (observed.some((value) => value !== `${prefix}${reference.value}`))
      return false;
    matched ||= observed.length === 1;
  }
  return matched;
}
