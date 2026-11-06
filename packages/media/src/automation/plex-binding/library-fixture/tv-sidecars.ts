import type { MediaActor } from "#application/auth.ts";
import type { PrismaMigrationAdministration } from "#migration/persistence.ts";
import { captureFixture } from "#migration/bundle-test-fixtures.ts";
import {
  uploadInitialMovieSidecars,
  type InitialMovieSidecar,
} from "./movie-sidecars.ts";

/** Actual explicit Sonarr ancestry for initial TV files. The historical Radarr
 * uploader and absent-sidecar capture behavior remain their original branch. */
export async function uploadLibraryFixtureSidecarsV1(input: {
  administration: PrismaMigrationAdministration;
  actor: MediaActor;
  kind: "movies" | "tv";
  movieInstanceId: string;
  tvInstanceId: string;
  sidecars: InitialMovieSidecar[] | undefined;
}) {
  if (input.kind !== "tv" || input.sidecars === undefined)
    return uploadInitialMovieSidecars({
      administration: input.administration,
      actor: input.actor,
      managerInstanceId: input.movieInstanceId,
      sidecars: input.sidecars,
    });
  return input.administration.upload(input.actor, {
    snapshot: captureFixture(
      "bazarr",
      input.sidecars.map((sidecar, index) => ({
        kind: "subtitle" as const,
        sourceId: `initial-tv-sidecar-${String(index)}`,
        mediaSourceId: `sonarr:${sidecar.mediaSourceId}`,
        videoPath: sidecar.videoPath,
        path: sidecar.path,
        embeddedTrackId: null,
        language: sidecar.language,
        forced: false,
        hearingImpaired: false,
        checksum: null,
        provenance: "unknown" as const,
        managerReference: {
          kind: "sonarr" as const,
          sourceMediaId: sidecar.mediaSourceId,
          sourceInstanceId: input.tvInstanceId,
          binding: "owner_declared" as const,
        },
      })),
    ),
  });
}
