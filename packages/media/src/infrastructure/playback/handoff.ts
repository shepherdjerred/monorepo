import type { MediaActor } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";
import type { PlexClient } from "#integrations/plex.ts";
import { LEGACY_OBSERVER_CONFIG } from "#integrations/legacy-observer/config.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { QuiescenceEvidenceSchema } from "#shared/legacy-observer.ts";
import type { PlaybackHandoffEvidence } from "#shared/household/playback.ts";
import type { Database } from "#infrastructure/database.ts";

/** Consume the Network worker's trusted observation without granting API K8s access. */
export function playbackHandoffReady(
  db: Database,
  libraryClient: (
    actor: MediaActor,
  ) => Promise<Pick<PlexClient, "activeSessions">>,
): (actor: MediaActor) => Promise<PlaybackHandoffEvidence> {
  return async (actor) => {
    const lease = await db.legacyWriterLease.findUnique({
      where: { id: "singleton" },
    });
    const runtime = await db.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    if (
      lease?.revokedAt !== null ||
      lease.recoveryEpoch !== runtime.recoveryEpoch
    )
      throw new MediaError(
        "legacy_history_not_quiescent",
        "Wait for the verified legacy writer shutdown before sealing playback history",
        409,
      );
    const evidence = QuiescenceEvidenceSchema.parse(lease.observation);
    const clear =
      evidence.quiescent &&
      evidence.blockers.length === 0 &&
      evidence.configurationDigest === snapshotHash(LEGACY_OBSERVER_CONFIG) &&
      evidence.targetsDigest ===
        snapshotHash(LEGACY_OBSERVER_CONFIG.legacyDeployments) &&
      evidence.controllers.length ===
        LEGACY_OBSERVER_CONFIG.legacyDeployments.length &&
      LEGACY_OBSERVER_CONFIG.legacyDeployments.every((name) =>
        evidence.controllers.some(
          (controller) =>
            controller.name === name &&
            controller.desired === 0 &&
            controller.current === 0 &&
            controller.ready === 0 &&
            controller.observedGeneration >= controller.generation,
        ),
      );
    if (
      !clear ||
      lease.observedAt.getTime() !== Date.parse(evidence.capturedAt) ||
      lease.expiresAt.getTime() !== Date.parse(evidence.expiresAt)
    )
      throw new MediaError(
        "legacy_history_not_quiescent",
        "The legacy history writer is not verified stopped",
        409,
      );
    const client = await libraryClient(actor);
    const sessions = await client.activeSessions();
    if (sessions.length > 0)
      throw new MediaError(
        "playback_handoff_active_sessions",
        "Finish current playback before the one-time history handoff",
        409,
      );
    const [current, currentRuntime] = await Promise.all([
      db.legacyWriterLease.findUnique({ where: { id: "singleton" } }),
      db.mediaRuntimeState.findUniqueOrThrow({ where: { id: "singleton" } }),
    ]);
    const now = Date.now();
    if (
      current?.version !== lease.version ||
      current.revokedAt !== null ||
      currentRuntime.recoveryEpoch !== runtime.recoveryEpoch ||
      lease.observedAt.getTime() > now ||
      lease.expiresAt.getTime() <= now ||
      lease.expiresAt.getTime() - lease.observedAt.getTime() > 120_000
    )
      throw new MediaError(
        "playback_handoff_proof_expired",
        "Refresh the legacy writer observation before sealing history",
        409,
      );
    return {
      capturedAt: lease.observedAt,
      expiresAt: lease.expiresAt,
      inventoryDigest: evidence.inventoryDigest,
    };
  };
}
