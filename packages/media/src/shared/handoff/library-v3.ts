import { z } from "zod";
import { HandoffFileEvidenceSchema } from "#shared/handoff.ts";
import {
  PrepareLibraryHandoffV2Schema,
  ApplyLibraryHandoffV2Schema,
  LibraryHandoffScopeV2Schema,
  HandoffNetworkV2Schema,
  LibraryHandoffSelectionV2Schema,
} from "#shared/handoff-v2.ts";
import { MovieEditionHashSchema } from "#shared/movie-editions/registry.ts";
import {
  PlexEditionChangeV1Schema,
  PlexEditionSnapshotV1Schema,
  PlexEditionProofV1Schema,
  PlexEditionIdentityV1Schema,
  HandoffObservationRefV1Schema,
} from "./plex-edition.ts";

/** New owner-approved metadata effects; earlier handoffs remain strictly read-only. */
export const PrepareLibraryHandoffV3Schema =
  PrepareLibraryHandoffV2Schema.extend({
    schemaVersion: z.literal(3),
    plexEditionLabels: z.literal("update_in_place"),
  });
export const ApplyLibraryHandoffV3Schema = ApplyLibraryHandoffV2Schema.extend({
  schemaVersion: z.literal(3),
});
export const LibraryHandoffScopeV3Schema = LibraryHandoffScopeV2Schema.extend({
  schemaVersion: z.literal(3),
  request: PrepareLibraryHandoffV3Schema,
});
export const HandoffNetworkV3Schema = HandoffNetworkV2Schema.extend({
  schemaVersion: z.literal(3),
  plex: z
    .array(
      HandoffNetworkV2Schema.shape.plex.element.extend({
        movieEdition: PlexEditionSnapshotV1Schema.nullable(),
      }),
    )
    .max(1000),
});
export const StableHandoffNetworkV3Schema = z.strictObject({
  schemaVersion: z.literal(3),
  planId: z.uuid(),
  recoveryEpoch: z.int().nonnegative(),
  controllers: HandoffNetworkV2Schema.shape.quiescence.shape.controllers,
  configurationDigest: MovieEditionHashSchema,
  targetsDigest: MovieEditionHashSchema,
  mounts: HandoffNetworkV2Schema.shape.mounts.shape.bindings,
  claims: HandoffNetworkV2Schema.shape.claims,
  plex: z
    .array(
      HandoffNetworkV2Schema.shape.plex.element.extend({
        movieEdition: z
          .strictObject({
            identity: PlexEditionIdentityV1Schema,
            identityHash: MovieEditionHashSchema,
          })
          .nullable(),
      }),
    )
    .max(1000),
  torrents: HandoffNetworkV2Schema.shape.torrents,
});
export const FinishedLibraryHandoffV3Schema = z.strictObject({
  schemaVersion: z.literal(3),
  scopeHash: MovieEditionHashSchema,
  network: z.json(),
  files: z.json(),
  plexEdits: z.array(PlexEditionChangeV1Schema).max(25),
});
export const LibraryHandoffSelectionV3Schema =
  LibraryHandoffSelectionV2Schema.extend({
    schemaVersion: z.literal(3),
    scope: LibraryHandoffScopeV3Schema,
    plexEdits: z.array(PlexEditionProofV1Schema).max(25),
  });
export type LibraryHandoffScopeV3 = z.infer<typeof LibraryHandoffScopeV3Schema>;
export const LibraryPlexEditOperationV3Schema = z.strictObject({
  schemaVersion: z.literal(3),
  operationId: z.uuid(),
  planId: z.uuid(),
  assetId: z.uuid(),
});
export const LibraryPlexFileProofV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  operationId: z.uuid(),
  planId: z.uuid(),
  assetId: z.uuid(),
  planHash: MovieEditionHashSchema,
  recoveryEpoch: z.int().nonnegative(),
  workerPodUid: z.string().min(1),
  file: HandoffFileEvidenceSchema.shape.files.element,
  networkObservation: HandoffObservationRefV1Schema,
  readObservedAt: z.iso.datetime(),
  readSdkExpiresAt: z.iso.datetime(),
  capturedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export type LibraryPlexEditOperationV3 = z.infer<
  typeof LibraryPlexEditOperationV3Schema
>;
