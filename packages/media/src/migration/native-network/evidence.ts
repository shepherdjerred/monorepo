import type {
  ApprovedStorageRoot,
  CanonicalMountEvidence,
} from "#shared/canonical-storage.ts";
import type { QuiescenceEvidence } from "#shared/legacy-observer.ts";
import { LEGACY_OBSERVER_CONFIG } from "#integrations/legacy-observer/config.ts";
import { snapshotHash } from "#migration/profile-import.ts";

export function assertObservationFresh(proof: {
  capturedAt: string;
  expiresAt: string;
  configurationDigest: string;
}) {
  const now = Date.now(),
    captured = Date.parse(proof.capturedAt),
    expires = Date.parse(proof.expiresAt);
  if (
    captured > now ||
    expires <= now ||
    expires - captured > 120_000 ||
    proof.configurationDigest !== snapshotHash(LEGACY_OBSERVER_CONFIG)
  )
    throw new Error(
      "Native recovery observation expired or configuration changed",
    );
}
export function assertWritersQuiescent(proof: QuiescenceEvidence) {
  assertObservationFresh(proof);
  const names = LEGACY_OBSERVER_CONFIG.legacyDeployments;
  if (
    !proof.quiescent ||
    proof.blockers.length > 0 ||
    proof.targetsDigest !== snapshotHash(names) ||
    proof.controllers.length !== names.length ||
    !names.every((name) =>
      proof.controllers.some(
        (controller) =>
          controller.name === name &&
          controller.desired === 0 &&
          controller.current === 0 &&
          controller.ready === 0 &&
          controller.observedGeneration >= controller.generation,
      ),
    )
  )
    throw new Error("Native recovery legacy writers remain protected");
}
export function assertCanonicalIdentity(
  proof: CanonicalMountEvidence,
  roots: ApprovedStorageRoot[],
) {
  assertObservationFresh(proof);
  if (
    !roots.every((root) =>
      proof.mounts.some(
        (mount) =>
          mount.root === root.rootPath &&
          mount.pvcUid === root.pvcUid &&
          mount.volumeName === root.volumeName &&
          mount.volumePath === root.volumePath,
      ),
    )
  )
    throw new Error(
      "Native recovery canonical storage differs from owner-approved receipt",
    );
}
