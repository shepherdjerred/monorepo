import {
  NativeArchiveFileEvidenceSchema,
  NativeArchiveNetworkEvidenceSchema,
} from "#shared/native-recovery/archive.ts";

export function stableArchiveFiles(raw: unknown) {
  const { capturedAt: _capturedAt, ...evidence } =
    NativeArchiveFileEvidenceSchema.parse(raw);
  return evidence;
}
export function stableArchiveNetwork(raw: unknown) {
  const evidence = NativeArchiveNetworkEvidenceSchema.parse(raw);
  return {
    schemaVersion: evidence.schemaVersion,
    lifecycleKind: evidence.lifecycleKind,
    planId: evidence.planId,
    recoveryEpoch: evidence.recoveryEpoch,
    configurationDigest: evidence.mounts.configurationDigest,
    targetsDigest: evidence.quiescence.targetsDigest,
    controllers: evidence.quiescence.controllers,
    mounts: evidence.mounts.mounts,
    ...(evidence.supersededCoordinators === undefined
      ? {}
      : {
          supersededCoordinators: evidence.supersededCoordinators.map(
            ({
              continuationId,
              closedCoordinator: {
                observedAt: _observed,
                ...closedCoordinator
              },
            }) => ({ continuationId, closedCoordinator }),
          ),
        }),
    plex: {
      currentPlayback: evidence.plex.currentPlayback,
      archiveAbsence: evidence.plex.archiveAbsence.map(
        ({ inventoryDigest: _digest, ...item }) => item,
      ),
      inventory: evidence.plex.inventory.map(({ sectionId, kind }) => ({
        sectionId,
        kind,
      })),
      playback: {
        state: evidence.plex.playback.state,
        scopeHash: evidence.plex.playback.scopeHash,
      },
    },
    torrents: evidence.torrents,
  };
}
