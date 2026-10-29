import { z } from "zod";
import {
  PrepareHandoffSchema,
  HandoffFileSchema,
  HandoffScopeSchema,
  HandoffNetworkEvidenceSchema,
  HandoffFileEvidenceSchema,
  ApplyHandoffSchema,
} from "./handoff.ts";
import {
  MovieEditionKeySchema,
  MovieEditionDefinitionRefSchema,
} from "./movie-editions/registry.ts";
import { MovieCutEvidenceV2Schema } from "./movie-editions/cut-v2.ts";
import { EvidenceHashSchema } from "./migration.ts";
import { MoviePublicationAssetV2Schema } from "./movie-editions/publication-v2.ts";
import { PublicationAssetSnapshotSchema } from "./publication-proof/intent.ts";

const Resolution = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("conventional") }),
  z.strictObject({
    kind: z.literal("owner_review"),
    reason: z.string().trim().min(8).max(1000),
  }),
]);
export const PrepareLibraryHandoffV2Schema = PrepareHandoffSchema.safeExtend({
  schemaVersion: z.literal(2),
  purpose: z.literal("migration"),
  movies: z
    .array(
      z.strictObject({
        provenanceKey: EvidenceHashSchema,
        edition: MovieEditionKeySchema,
        resolution: Resolution,
      }),
    )
    .max(25),
});
const Classification = z.strictObject({
  schemaVersion: z.literal(1),
  parserVersion: z.literal("cut-markers-v2"),
  provenanceKey: EvidenceHashSchema,
  observationHash: EvidenceHashSchema,
  canonicalDigest: EvidenceHashSchema,
  texts: MovieCutEvidenceV2Schema.shape.texts,
  issues: MovieCutEvidenceV2Schema.shape.issues,
  conclusion: MovieCutEvidenceV2Schema.shape.conclusion,
  resolution: Resolution,
  definition: MovieEditionDefinitionRefSchema,
});
const File = HandoffFileSchema.safeExtend({
  edition: MovieEditionKeySchema,
  classification: Classification.nullable(),
}).refine(
  (file) =>
    file.libraryKind === "movies"
      ? file.classification !== null && file.mediaIds.length === 1
      : file.edition === "default" && file.classification === null,
  "Only movie files have a cut classification",
);
export const LibraryHandoffScopeV2Schema = HandoffScopeSchema.safeExtend({
  schemaVersion: z.literal(2),
  request: PrepareLibraryHandoffV2Schema,
  files: z.array(File).max(25),
  claims: z.array(HandoffScopeSchema.shape.claims.element).max(0),
  targets: z
    .array(
      z.strictObject({
        mediaId: z.uuid(),
        edition: MovieEditionKeySchema,
        generation: z.int().nonnegative().nullable(),
        version: z.int().nonnegative().nullable(),
      }),
    )
    .max(100),
});
export const HandoffScopeProtocolSchema = z.union([
  HandoffScopeSchema,
  LibraryHandoffScopeV2Schema,
]);
export const PrepareHandoffProtocolSchema = z.union([
  PrepareHandoffSchema,
  PrepareLibraryHandoffV2Schema,
]);
export const ApplyLibraryHandoffV2Schema = ApplyHandoffSchema.omit({
  acknowledgeProtectedLegacySources: true,
}).extend({ schemaVersion: z.literal(2) });
export const ApplyHandoffProtocolSchema = z.union([
  ApplyHandoffSchema,
  ApplyLibraryHandoffV2Schema,
]);
export const HandoffNetworkV2Schema = HandoffNetworkEvidenceSchema.extend({
  schemaVersion: z.literal(2),
  claims: z.array(HandoffNetworkEvidenceSchema.shape.claims.element).max(0),
  torrents: z.array(HandoffNetworkEvidenceSchema.shape.torrents.element).max(0),
  plex: z
    .array(
      HandoffNetworkEvidenceSchema.shape.plex.element.safeExtend({
        assetId: z.uuid(),
        edition: MovieEditionKeySchema,
        editionTitle: z.string().max(256).nullable(),
        partId: z.int().nonnegative(),
      }),
    )
    .max(1000),
});
export const HandoffNetworkProtocolSchema = z.union([
  HandoffNetworkEvidenceSchema,
  HandoffNetworkV2Schema,
]);
export type HandoffProtocolScope = z.infer<typeof HandoffScopeProtocolSchema>;
export type LibraryHandoffScopeV2 = z.infer<typeof LibraryHandoffScopeV2Schema>;
export const FinishedLibraryHandoffV2Schema = z.strictObject({
  schemaVersion: z.literal(2),
  scopeHash: EvidenceHashSchema,
  network: z.json(),
  files: z.json(),
});
export const LibraryHandoffSelectionV2Schema = z.strictObject({
  schemaVersion: z.literal(2),
  scope: LibraryHandoffScopeV2Schema,
  fileEvidence: HandoffFileEvidenceSchema.pick({
    planId: true,
    recoveryEpoch: true,
    workerPodUid: true,
    files: true,
  }),
  networkEvidence: z.json(),
  protected: LibraryHandoffScopeV2Schema.shape.protected,
  assets: z
    .array(
      z.union([MoviePublicationAssetV2Schema, PublicationAssetSnapshotSchema]),
    )
    .max(25),
});

export function handoffProtocolVersion(scope: HandoffProtocolScope): 1 | 2 {
  return "schemaVersion" in scope ? 2 : 1;
}

export function assertHandoffNetworkProtocol(
  scope: HandoffProtocolScope,
  network: { schemaVersion: 1 | 2 },
): void {
  if (network.schemaVersion !== handoffProtocolVersion(scope))
    throw new Error("Handoff file and network protocols differ");
}

export function handoffFileEdition(
  file: HandoffProtocolScope["files"][number],
): z.infer<typeof MovieEditionKeySchema> {
  return "edition" in file ? file.edition : "default";
}
