import { z } from "zod";
import {
  CatalogReferenceSchema,
  ProviderReferenceSchema,
  ProviderEditionEvidenceSchema,
} from "./catalog.ts";
import {
  CoordinateSnapshotSchema,
  EpisodeCoordinateEvidenceSchema,
} from "./coordinates.ts";

const Hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const CandidateSourceEvidenceSchema = z.strictObject({
  infoHash: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u),
  references: z.array(ProviderReferenceSchema).max(20).optional(),
  editionEvidence: z.array(ProviderEditionEvidenceSchema).max(20).optional(),
});
export const CanonicalIdentitySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("movie"),
    mediaId: z.uuid(),
    mediaVersion: z.number().int().nonnegative(),
    catalogDigest: Hash,
  }),
  z.strictObject({
    kind: z.literal("series"),
    coordinates: CoordinateSnapshotSchema,
  }),
]);
export const IdentityDecisionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  actorId: z.uuid(),
  releaseId: z.uuid(),
  candidateDigest: Hash,
  recoveryEpoch: z.number().int().nonnegative(),
  serverMachineId: z.string().min(1),
  canonical: CanonicalIdentitySchema,
  coverage: z.array(z.uuid()).min(1).max(100),
  reviewedMedia: z
    .array(
      z.strictObject({
        id: z.uuid(),
        version: z.number().int().nonnegative(),
        generation: z.number().int().nonnegative(),
      }),
    )
    .min(1)
    .max(100),
  reason: z.string().trim().min(10).max(2000),
  evidenceHash: Hash,
});
export const AcquisitionIdentitySnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  source: z.strictObject({ releaseId: z.uuid(), candidateDigest: Hash }),
  proof: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("automatic"),
      basis: z.enum(["title_year", "strong_reference"]),
      references: z.array(CatalogReferenceSchema).max(20),
      evidenceHash: Hash,
    }),
    z.strictObject({
      kind: z.literal("owner"),
      decisionOperationId: z.uuid(),
      decisionHash: Hash,
    }),
  ]),
  canonical: CanonicalIdentitySchema,
  coverage: z.array(z.uuid()).min(1).max(100),
  sponsorRequestId: z.uuid(),
  sponsorAuthority: z.strictObject({
    userId: z.uuid(),
    actorId: z.uuid(),
    serverMachineId: z.string().min(1),
  }),
  birthEpoch: z.number().int().nonnegative(),
});
export const FileIdentityEvidenceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  attemptIdentityHash: Hash,
  numberingDigest: Hash.nullable(),
  sourceFile: z.strictObject({
    torrentFileIndex: z.number().int().nonnegative(),
    relativePath: z.string().min(1).max(4096),
    sizeBytes: z.string().regex(/^\d+$/u),
  }),
  parsedCoordinates: z.union([
    EpisodeCoordinateEvidenceSchema,
    z.strictObject({ kind: z.literal("movie") }),
  ]),
  coverage: z.array(z.uuid()).min(1).max(100),
});
export type CanonicalIdentity = z.infer<typeof CanonicalIdentitySchema>;
export type IdentityDecision = z.infer<typeof IdentityDecisionSchema>;
export type AcquisitionIdentitySnapshot = z.infer<
  typeof AcquisitionIdentitySnapshotSchema
>;
export type FileIdentityEvidence = z.infer<typeof FileIdentityEvidenceSchema>;
