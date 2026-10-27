import { z } from "zod";
import {
  AcquisitionIdentitySnapshotSchema,
  CanonicalIdentitySchema,
} from "./identity.ts";

const Hash = z.string().regex(/^[a-f0-9]{64}$/u);
const Targets = z
  .array(
    z.strictObject({ mediaId: z.uuid(), generation: z.int().nonnegative() }),
  )
  .min(1)
  .max(100)
  .refine(
    (targets) =>
      targets.every(
        (target, index) =>
          index === 0 || (targets[index - 1]?.mediaId ?? "") < target.mediaId,
      ),
    "Library management targets must be sorted and distinct",
  );

/** Current household policy derives from a real initial-library approval, independently of personal requests. */
export const LibraryEpisodeManagementV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("library_series_management"),
  seriesId: z.uuid(),
  receiptId: z.uuid(),
  planId: z.uuid(),
  planHash: Hash,
  selectionHash: Hash,
  actorId: z.uuid(),
  serverMachineId: z.string().min(1),
  sectionId: z.string().min(1),
  association: z.strictObject({ evidenceId: z.uuid(), associationHash: Hash }),
  profileId: z.uuid(),
  profileVersionAtCapture: z.int().nonnegative(),
  rootGenerationAtCapture: z.int().nonnegative().nullable(),
  birthEpoch: z.int().nonnegative(),
  targets: Targets,
});

/** An explicitly selected captured series, rather than inferred permission from its imported episodes. */
export const LibrarySeriesManagementV2Schema =
  LibraryEpisodeManagementV1Schema.extend({
    schemaVersion: z.literal(2),
    policyScope: z.literal("series"),
    includeSpecials: z.boolean(),
    rootGenerationAtCapture: z.int().positive(),
  });
export const LibrarySeriesManagementSchema = z.discriminatedUnion(
  "schemaVersion",
  [LibraryEpisodeManagementV1Schema, LibrarySeriesManagementV2Schema],
);

/** Additive identity: literal request-sponsored v1 and movie v2/v3 records retain their original shapes. */
export const ManagedSeriesAcquisitionIdentitySchema = z
  .strictObject({
    schemaVersion: z.literal(4),
    source: AcquisitionIdentitySnapshotSchema.shape.source,
    proof: AcquisitionIdentitySnapshotSchema.shape.proof,
    canonical: CanonicalIdentitySchema.options[1],
    coverage: z.array(z.uuid()).min(1).max(100),
    birthEpoch: z.int().nonnegative(),
    management: LibrarySeriesManagementSchema,
  })
  .refine(
    (identity) =>
      identity.canonical.coordinates.seriesId ===
        identity.management.seriesId &&
      identity.birthEpoch === identity.management.birthEpoch &&
      identity.coverage.length === identity.management.targets.length &&
      identity.coverage.every(
        (id, index) => id === identity.management.targets[index]?.mediaId,
      ),
    "Library acquisition must retain its exact series and managed coverage",
  );

export const DefaultAcquisitionIdentitySchema = z.union([
  AcquisitionIdentitySnapshotSchema,
  ManagedSeriesAcquisitionIdentitySchema,
]);
export type DefaultAcquisitionIdentity = z.infer<
  typeof DefaultAcquisitionIdentitySchema
>;
export type LibrarySeriesManagement = z.infer<
  typeof LibrarySeriesManagementSchema
>;

export function managedSeriesIdentity(raw: unknown) {
  if (raw === null) return null;
  const identity = DefaultAcquisitionIdentitySchema.parse(raw);
  return identity.schemaVersion === 4 ? identity : null;
}
