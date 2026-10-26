import { z } from "zod";
import { DefaultEditionScopeSchema } from "#shared/editions/scope.ts";
import { MovieEditionKeySchema } from "#shared/movie-editions/registry.ts";
import {
  PlexDecimalIdSchema,
  PlexServerIdSchema,
} from "#shared/plex-events/contract.ts";
import { NativeRecoveryFileSchema } from "#shared/native-recovery.ts";
import { PublicationHashSchema as Hash } from "#shared/publication-proof/effects.ts";

export const PlexBindingScopeSchema = DefaultEditionScopeSchema.extend({
  edition: MovieEditionKeySchema,
});
export const PlexAccessSchema = z.strictObject({
  serverMachineId: PlexServerIdSchema,
  sectionId: PlexDecimalIdSchema,
  sectionType: z.enum(["movie", "show"]),
});
export const PlexDefinitionRefSchema = z.strictObject({
  rootMediaId: z.uuid(),
  key: MovieEditionKeySchema,
  definitionVersion: z.int().nonnegative(),
  definitionHash: Hash,
});

export function plexScopeKey(scope: {
  mediaId: string;
  edition: string;
}): string {
  return `${scope.mediaId}/${scope.edition}`;
}

export function plexSortedUnique(values: readonly string[]): boolean {
  return values.every((value, index) => {
    const previous = values[index - 1];
    return previous === undefined || previous < value;
  });
}

export const PlexPhysicalGroupSchema = NativeRecoveryFileSchema.pick({
  assetId: true,
  assetVersion: true,
  checksum: true,
  sizeBytes: true,
  canonicalPath: true,
  ownershipEpoch: true,
})
  .extend({
    canonicalRootId: z.uuid(),
    edition: MovieEditionKeySchema,
    coverage: z.array(PlexBindingScopeSchema).min(1).max(10_000),
    coverageHash: Hash,
  })
  .refine(
    (group) =>
      plexSortedUnique(group.coverage.map((scope) => plexScopeKey(scope))) &&
      group.coverage.every((scope) => scope.edition === group.edition),
    "Plex group requires complete sorted distinct same-edition coverage",
  );

const Guids = z
  .array(z.string().min(1).max(2048))
  .max(100)
  .refine(plexSortedUnique, "Plex GUIDs must be normalized sorted and unique");
export const PlexPartIdentitySchema = z.strictObject({
  id: PlexDecimalIdSchema,
  file: z.string().min(1).max(4096),
  sizeBytes: z.string().regex(/^\d+$/u).optional(),
});
export const PlexItemIdentitySchema = z.strictObject({
  ratingKey: PlexDecimalIdSchema,
  type: z.enum(["movie", "episode"]),
  guids: Guids,
  media: z.tuple([
    z.strictObject({ parts: z.tuple([PlexPartIdentitySchema]) }),
  ]),
});
export const PlexEpisodeHierarchySchema = z.strictObject({
  episode: z.strictObject({
    ratingKey: PlexDecimalIdSchema,
    parentRatingKey: PlexDecimalIdSchema,
    grandparentRatingKey: PlexDecimalIdSchema,
    index: z.int().nonnegative(),
    parentIndex: z.int().nonnegative(),
  }),
  season: z.strictObject({
    ratingKey: PlexDecimalIdSchema,
    type: z.literal("season"),
    index: z.int().nonnegative(),
    parentRatingKey: PlexDecimalIdSchema,
    sectionId: PlexDecimalIdSchema.optional(),
  }),
  show: z.strictObject({
    ratingKey: PlexDecimalIdSchema,
    type: z.literal("show"),
    guids: Guids,
    sectionId: PlexDecimalIdSchema.optional(),
  }),
});
const Association = z.strictObject({
  schemaVersion: z.literal(1),
  scope: PlexBindingScopeSchema,
  editionRootId: z.uuid(),
  definition: PlexDefinitionRefSchema,
  canonicalIdentityHash: Hash,
  numberingHash: Hash,
  group: PlexPhysicalGroupSchema,
  access: PlexAccessSchema,
});
export const PlexAssociationV1Schema = z
  .discriminatedUnion("kind", [
    Association.extend({
      kind: z.literal("movie"),
      item: PlexItemIdentitySchema.extend({ type: z.literal("movie") }),
    }),
    Association.extend({
      kind: z.literal("episode"),
      item: PlexItemIdentitySchema.extend({ type: z.literal("episode") }),
      hierarchy: PlexEpisodeHierarchySchema,
    }),
  ])
  .refine(associationScopeMatches, "Plex association scope or Part changed")
  .refine(associationHierarchyMatches, "Plex association hierarchy changed");

function associationScopeMatches(
  value: z.infer<typeof Association> & {
    kind: "movie" | "episode";
    item: z.infer<typeof PlexItemIdentitySchema>;
  },
) {
  const part = value.item.media[0].parts[0];
  return (
    value.editionRootId === value.definition.rootMediaId &&
    value.editionRootId === value.group.canonicalRootId &&
    value.scope.edition === value.definition.key &&
    value.scope.edition === value.group.edition &&
    value.group.coverage.some(
      (scope) => plexScopeKey(scope) === plexScopeKey(value.scope),
    ) &&
    part.file === value.group.canonicalPath &&
    (part.sizeBytes === undefined ||
      part.sizeBytes === value.group.sizeBytes) &&
    (value.kind !== "movie" ||
      (value.group.coverage.length === 1 &&
        value.scope.mediaId === value.editionRootId)) &&
    value.access.sectionType === (value.kind === "movie" ? "movie" : "show")
  );
}

function associationHierarchyMatches(
  value: z.infer<typeof Association> &
    (
      | { kind: "movie"; item: z.infer<typeof PlexItemIdentitySchema> }
      | {
          kind: "episode";
          item: z.infer<typeof PlexItemIdentitySchema>;
          hierarchy: z.infer<typeof PlexEpisodeHierarchySchema>;
        }
    ),
) {
  if (value.kind === "movie") return true;
  const { episode, season, show } = value.hierarchy;
  return (
    episode.ratingKey === value.item.ratingKey &&
    episode.parentRatingKey === season.ratingKey &&
    episode.grandparentRatingKey === show.ratingKey &&
    episode.parentIndex === season.index &&
    season.parentRatingKey === show.ratingKey &&
    (season.sectionId === undefined ||
      season.sectionId === value.access.sectionId) &&
    (show.sectionId === undefined || show.sectionId === value.access.sectionId)
  );
}

export const PlexBindingSnapshotSchema = z.strictObject({
  scope: PlexBindingScopeSchema,
  evidenceId: z.uuid(),
  associationHash: Hash,
  revision: z.int().positive(),
});
export const PlexPointerExpectedSchema = z.strictObject({
  scope: PlexBindingScopeSchema,
  revision: z.int().nonnegative(),
  evidence: z.strictObject({ id: z.uuid(), associationHash: Hash }).nullable(),
});
export const PlexBindingReasonSchema = z.enum([
  "missing_binding",
  "binding_changed",
  "scope_changed",
  "ownership_changed",
  "compensation_fence_active",
  "wrong_server",
  "wrong_section",
  "incomplete_inventory",
  "ambiguous_item",
  "unsupported_media_parts",
  "unresolved_identity",
  "unresolved_numbering",
  "metadata_changed",
  "verification_expired",
  "inaccessible",
  "reconciliation_required",
]);
export const PlexInvalidationReasonSchema = z.enum([
  "asset_changed",
  "identity_changed",
  "section_changed",
  "observed_absent",
  "ambiguous_item",
  "ownership_changed",
]);

export type PlexBindingScope = z.infer<typeof PlexBindingScopeSchema>;
export type PlexAccess = z.infer<typeof PlexAccessSchema>;
export type PlexDefinitionRef = z.infer<typeof PlexDefinitionRefSchema>;
export type PlexPhysicalGroup = z.infer<typeof PlexPhysicalGroupSchema>;
export type PlexPartIdentity = z.infer<typeof PlexPartIdentitySchema>;
export type PlexItemIdentity = z.infer<typeof PlexItemIdentitySchema>;
export type PlexEpisodeHierarchy = z.infer<typeof PlexEpisodeHierarchySchema>;
export type PlexAssociationV1 = z.infer<typeof PlexAssociationV1Schema>;
export type PlexBindingSnapshot = z.infer<typeof PlexBindingSnapshotSchema>;
export type PlexPointerExpected = z.infer<typeof PlexPointerExpectedSchema>;
export type PlexBindingReason = z.infer<typeof PlexBindingReasonSchema>;
export type PlexInvalidationReason = z.infer<
  typeof PlexInvalidationReasonSchema
>;
/** Process-local deadline; never include this port in stored or Workflow JSON. */
export type PlexBindingFreshness = {
  readonly expiresAtMs: number;
  assertActive: () => void;
};
export type PlexBindingRead =
  | {
      status: "current";
      purpose: "current_serving";
      snapshot: PlexBindingSnapshot;
      association: PlexAssociationV1;
    }
  | { status: "protected"; reason: PlexBindingReason };
export type LegacyPlexDisplay =
  | {
      status: "legacy_association_unverified";
      ratingKey: string;
      sectionId: string;
    }
  | { status: "protected"; reason: PlexBindingReason };
