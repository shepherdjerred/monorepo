import { z } from "zod";
import type { AcquisitionAttempt } from "#generated/prisma/client.ts";
import { StoredTorrentObservationSchema } from "#integrations/qbittorrent.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { canonicalJson } from "#migration/profile-import.ts";
import { FileGuardError } from "#automation/files/types.ts";
import type { SeriesPackStagingScopeV1 } from "#shared/acquisition/series-pack-staging-v1.ts";
import { SeriesPackStagingObservationV1Schema } from "./scope.ts";

const ReadyObservation = z.object({
  torrent: StoredTorrentObservationSchema.extend({ progress: z.literal(1) }),
  files: z.array(z.json()).min(1).max(1000),
});
// A separate CURRENT identity/layout comparison. The original complete raw
// observation, including these operational metrics, remains byte-literal.
function currentProjection(raw: unknown) {
  SeriesPackStagingObservationV1Schema.parse(raw);
  ReadyObservation.parse(raw);
  const body = z.record(z.string(), z.json()).parse(raw);
  const torrent = z.record(z.string(), z.json()).parse(body["torrent"]);
  const critical = Object.fromEntries(
    Object.entries(torrent).filter(
      ([key]) => !["ratio", "seeding_time", "state"].includes(key),
    ),
  );
  return { ...body, torrent: critical };
}

export function assertSeriesPackStagingObservationCurrentV1(
  scope: SeriesPackStagingScopeV1,
  current: unknown,
) {
  const original: unknown = JSON.parse(scope.observationRaw);
  if (
    canonicalJson(z.json().parse(original)) !== scope.observationRaw ||
    identityHash(original) !== scope.observationHash
  )
    throw new Error("Series pack original ready observation raw hash changed");
  if (
    identityHash(currentProjection(original)) !==
    identityHash(currentProjection(current))
  )
    throw new FileGuardError("series_pack_staging_scope_changed");
}

/** Current state is queried separately; an earlier transaction never supplies consent. */
export function assertSeriesPackStagingAttemptCurrentV1(
  attempt: AcquisitionAttempt,
  scope: SeriesPackStagingScopeV1,
) {
  if (attempt.coordinatorOperationId !== scope.operationId)
    throw new FileGuardError("acquisition_obsolete");
  if (
    attempt.id !== scope.attemptId ||
    attempt.operationId !== scope.attemptOperationId ||
    attempt.recoveryEpoch !== scope.recoveryEpoch ||
    identityHash(attempt.identityEvidence) !== scope.identityHash ||
    canonicalJson(z.json().parse(attempt.identityEvidence)) !==
      scope.identityRaw ||
    identityHash(attempt.generations) !== scope.generationsHash ||
    canonicalJson(z.json().parse(attempt.generations)) !==
      scope.generationsRaw ||
    identityHash([...attempt.mediaIds].sort()) !== identityHash(scope.coverage)
  )
    throw new FileGuardError("series_pack_staging_scope_changed");
}
