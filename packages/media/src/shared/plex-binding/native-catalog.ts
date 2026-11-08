import { z } from "zod";
import { PublicationHashSchema as Hash } from "#shared/publication-proof/effects.ts";
import { PlexCanonicalTargetSchema } from "./canonical.ts";
import { PlexDecimalIdSchema } from "#shared/plex-events/contract.ts";
import {
  PlexAccessSchema,
  PlexBindingScopeSchema,
  PlexItemIdentitySchema,
  PlexEpisodeHierarchySchema,
  plexScopeKey,
  plexSortedUnique,
} from "./contract.ts";

export const NativeCompensationCatalogItemSchema = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({
      kind: z.literal("movie"),
      scope: PlexBindingScopeSchema,
      sectionId: PlexDecimalIdSchema.optional(),
      item: PlexItemIdentitySchema.extend({ type: z.literal("movie") }),
    }),
    z.strictObject({
      kind: z.literal("episode"),
      scope: PlexBindingScopeSchema,
      sectionId: PlexDecimalIdSchema.optional(),
      item: PlexItemIdentitySchema.extend({ type: z.literal("episode") }),
      hierarchy: PlexEpisodeHierarchySchema,
    }),
  ],
);
const Candidate = z.strictObject({ assetId: z.uuid(), sourceHash: Hash });
/** Catalog identity/location only. This never identifies the bytes currently occupying the path. */
export const NativeCompensationCatalogEntrySchema = z
  .strictObject({
    entryOperationId: z.string().regex(/^[\w-]{1,100}$/u),
    entryHash: Hash,
    canonicalPath: z.string().min(1).max(4096),
    access: PlexAccessSchema,
    compatiblePhysicalCandidates: z.tuple([
      Candidate.extend({ role: z.literal("predecessor") }),
      Candidate.extend({ role: z.literal("successor") }),
    ]),
    targets: z.array(PlexCanonicalTargetSchema).min(1).max(100),
    items: z.array(NativeCompensationCatalogItemSchema).max(100),
  })
  .refine((value) => {
    const scopes = value.targets.map((target) => plexScopeKey(target.scope));
    return (
      plexSortedUnique(scopes) &&
      value.compatiblePhysicalCandidates[0].assetId !==
        value.compatiblePhysicalCandidates[1].assetId &&
      new Set(value.targets.map((target) => target.canonicalRootId)).size ===
        1 &&
      value.targets.every(
        (target) =>
          target.scope.edition === "default" &&
          (target.kind === "movie" ? "movie" : "show") ===
            value.access.sectionType,
      ) &&
      (value.items.length === 0 ||
        (value.items.length === scopes.length &&
          value.items.every(
            (item, index) =>
              plexScopeKey(item.scope) === scopes[index] &&
              item.kind === value.targets[index]?.kind &&
              item.item.media[0].parts[0].file === value.canonicalPath,
          ))) &&
      new Set(value.items.map((item) => item.item.ratingKey)).size ===
        value.items.length
    );
  }, "Compensation catalog observation must cover one exact complete physical candidate group");
export const NativeCompensationCatalogSchema = z
  .array(NativeCompensationCatalogEntrySchema)
  .min(1)
  .max(25)
  .refine(
    (entries) =>
      plexSortedUnique(entries.map((entry) => entry.entryOperationId)) &&
      new Set(
        entries.flatMap((entry) =>
          entry.targets.map((target) => plexScopeKey(target.scope)),
        ),
      ).size ===
        entries.reduce((count, entry) => count + entry.targets.length, 0),
    "Compensation catalog entries must be sorted, distinct and nonoverlapping",
  );
export type NativeCompensationCatalogEntry = z.infer<
  typeof NativeCompensationCatalogEntrySchema
>;
export type NativeCompensationCatalogItem = z.infer<
  typeof NativeCompensationCatalogItemSchema
>;
