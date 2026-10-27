import { z } from "zod";
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
