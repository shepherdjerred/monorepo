import { z } from "zod";
import { NativePublishedScopeSchema } from "#shared/native-recovery/lifecycle.ts";
import {
  NativeQuarantineScopeSchema,
  NativeQuarantineBindingSchema,
} from "#shared/native-recovery/quarantine.ts";
import {
  NativeArchiveScopeSchema,
  NativeArchiveBindingSchema,
} from "#shared/native-recovery/archive.ts";
import { FinishedNativeCompensationSchema } from "#shared/native-recovery/compensation.ts";
import { NativeCompensationSelectionSchema } from "#shared/native-recovery/compensation-runtime.ts";
import { PublicationAuthorityReferenceSchema } from "#shared/publication-proof/references.ts";
import { PublicationHashSchema as Hash } from "#shared/publication-proof/effects.ts";
import {
  NativePlexProofRefSchema,
  NativePlexSelectionRefsSchema,
} from "./native.ts";
import {
  PublishedPlexStableFilesSchema,
  PublishedPlexStableNetworkSchema,
  QuarantinePlexStableFilesSchema,
  QuarantinePlexStableNetworkSchema,
  ArchivePlexStableFilesSchema,
  ArchivePlexStableNetworkSchema,
  NativePlexPolicyBindingSchema,
} from "./native-projections.ts";

const Finished = z.strictObject({
  schemaVersion: z.literal(3),
  scopeHash: Hash,
  plex: NativePlexProofRefSchema,
});
export const FinishedPublishedPlexV3Schema = Finished.extend({
  lifecycleKind: z.literal("published"),
  network: PublishedPlexStableNetworkSchema,
  files: PublishedPlexStableFilesSchema,
});
export const FinishedQuarantinePlexV3Schema = Finished.extend({
  lifecycleKind: z.literal("committed_quarantine"),
  network: QuarantinePlexStableNetworkSchema,
  files: QuarantinePlexStableFilesSchema,
});
export const FinishedArchivePlexV3Schema = Finished.extend({
  lifecycleKind: z.literal("superseded_archive"),
  network: ArchivePlexStableNetworkSchema,
  files: ArchivePlexStableFilesSchema,
});
export const FinishedCompensationPlexV3Schema = Finished.extend({
  lifecycleKind: z.literal("publication_compensation"),
  network: FinishedNativeCompensationSchema.shape.network,
  files: FinishedNativeCompensationSchema.shape.files,
});
export const FinishedNativePlexV3Schema = z
  .discriminatedUnion("lifecycleKind", [
    FinishedPublishedPlexV3Schema,
    FinishedQuarantinePlexV3Schema,
    FinishedArchivePlexV3Schema,
    FinishedCompensationPlexV3Schema,
  ])
  .refine(
    (value) =>
      value.plex.parent.purpose === "native_review" &&
      value.plex.parent.lifecycleKind === value.lifecycleKind &&
      value.plex.parent.scopeHash === value.scopeHash,
    "Finished native Plex proof has a different parent",
  );

const Selection = z.strictObject({
  schemaVersion: z.literal(3),
  plex: NativePlexSelectionRefsSchema,
});
const Policies = z.array(NativePlexPolicyBindingSchema).max(100);
export const PublishedPlexSelectionV3Schema = Selection.extend({
  lifecycleKind: z.literal("published"),
  scope: NativePublishedScopeSchema,
  fileEvidence: PublishedPlexStableFilesSchema,
  networkEvidence: PublishedPlexStableNetworkSchema,
  bindings: z
    .array(NativeArchiveBindingSchema.omit({ physicalIdentityHash: true }))
    .min(1)
    .max(25),
  policies: Policies,
});
export const QuarantinePlexSelectionV3Schema = Selection.extend({
  lifecycleKind: z.literal("committed_quarantine"),
  scope: NativeQuarantineScopeSchema,
  fileEvidence: QuarantinePlexStableFilesSchema,
  networkEvidence: QuarantinePlexStableNetworkSchema,
  bindings: z.array(NativeQuarantineBindingSchema).min(1).max(25),
  policies: Policies,
});
export const ArchivePlexSelectionV3Schema = Selection.extend({
  lifecycleKind: z.literal("superseded_archive"),
  scope: NativeArchiveScopeSchema,
  fileEvidence: ArchivePlexStableFilesSchema,
  networkEvidence: ArchivePlexStableNetworkSchema,
  bindings: z.array(NativeArchiveBindingSchema).max(25),
  reusedBindings: z.array(PublicationAuthorityReferenceSchema).max(25),
  policies: Policies,
});
export const CompensationPlexSelectionV3Schema =
  NativeCompensationSelectionSchema.extend({
    schemaVersion: z.literal(3),
    lifecycleKind: z.literal("publication_compensation"),
    plex: NativePlexSelectionRefsSchema,
  });
export const NativePlexSelectionV3Schema = z
  .discriminatedUnion("lifecycleKind", [
    PublishedPlexSelectionV3Schema,
    QuarantinePlexSelectionV3Schema,
    ArchivePlexSelectionV3Schema,
    CompensationPlexSelectionV3Schema,
  ])
  .refine(
    (value) => value.plex.approved.parent.lifecycleKind === value.lifecycleKind,
    "Native selection lifecycle differs from its approved proof",
  );
export type FinishedNativePlexV3 = z.infer<typeof FinishedNativePlexV3Schema>;
export type NativePlexSelectionV3 = z.infer<typeof NativePlexSelectionV3Schema>;
