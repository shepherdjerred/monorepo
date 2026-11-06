import type { MediaActor } from "#application/auth.ts";
import type { PrismaMigrationAdministration } from "#migration/persistence.ts";
import { captureFixture } from "#migration/bundle-test-fixtures.ts";

export type InitialMovieSidecar = {
  language: string;
  path: string;
  videoPath: string;
  mediaSourceId: string;
};

/** Actual imported Bazarr observations, explicitly bound to this Radarr source by the owner. */
export async function uploadInitialMovieSidecars(input: {
  administration: PrismaMigrationAdministration;
  actor: MediaActor;
  managerInstanceId: string;
  sidecars: InitialMovieSidecar[] | undefined;
}) {
  if (input.sidecars === undefined) return;
  return input.administration.upload(input.actor, {
    snapshot: captureFixture(
      "bazarr",
      input.sidecars.map((sidecar, index) => ({
        kind: "subtitle" as const,
        sourceId: `initial-movie-sidecar-${String(index)}`,
        mediaSourceId: `radarr:${sidecar.mediaSourceId}`,
        videoPath: sidecar.videoPath,
        path: sidecar.path,
        embeddedTrackId: null,
        language: sidecar.language,
        forced: false,
        hearingImpaired: false,
        checksum: null,
        provenance: "unknown" as const,
        managerReference: {
          kind: "radarr" as const,
          sourceMediaId: sidecar.mediaSourceId,
          sourceInstanceId: input.managerInstanceId,
          binding: "owner_declared" as const,
        },
      })),
    ),
  });
}
