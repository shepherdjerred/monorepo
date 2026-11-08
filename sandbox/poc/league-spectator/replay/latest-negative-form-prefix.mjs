import { sha256 } from "./structural-comparison.mjs";
import { createLatestResourceRequestTrack } from "./latest-resource-requests.mjs";
import { NEGATIVE_FORM_PREFIX_PACKAGE_SHA } from "./latest-negative-form-prefix-contract.mjs";
import {
  assertSelectedFixedResourceProgram,
  assertSelectedResourceRoot,
  projectApprovedNegativeCapabilities,
} from "./latest-selected-resource-programs.mjs";

export const NEGATIVE_FORM_PREFIX_POLICY =
  "native-negative-form-conditional-prefix-v1";
const policies = new WeakSet();
const freeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
export const isLatestNegativeFormPrefix = (value) => policies.has(value);

// This classifies an observed request under a declared presentation policy.
// It cannot create or restore a resource stack, accept a unit or claim native
// snapshot restoration. An earlier invalidator remains an invalidator.
export async function createLatestNegativeFormPrefix({
  profile,
  packageBytes,
  effectsManifestBytes,
  staticCatalog = null,
}) {
  if ((await sha256(packageBytes)) !== NEGATIVE_FORM_PREFIX_PACKAGE_SHA)
    throw Error("Pinned negative-form conditional-prefix package required");
  if (staticCatalog !== null) {
    await assertSelectedFixedResourceProgram({
      selection: staticCatalog,
      profile,
      role: "negativeFormPrefix",
      packageBytes,
    });
    await assertSelectedResourceRoot({
      selection: staticCatalog,
      profile,
      manifestBytes: effectsManifestBytes,
    });
  }
  const metadata = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(packageBytes),
    ),
    manifest = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(effectsManifestBytes),
    ),
    s = metadata.scope;
  if (
    metadata.schema !== 1 ||
    metadata.kind !== "prepared-negative-form-conditional-prefix" ||
    metadata.policy !== NEGATIVE_FORM_PREFIX_POLICY ||
    metadata.build !== profile.clientVersion ||
    metadata.protocol !== profile.protocolDigest ||
    metadata.decoderImageSha256 !== profile.decoderImageSha256 ||
    metadata.build !== "16.21.829.8620" ||
    metadata.protocol !== "20e09df23c66b85e" ||
    (staticCatalog === null &&
      (await sha256(effectsManifestBytes)) !==
        metadata.effectsManifestSha256) ||
    !s?.staticBuildDataOnly ||
    s.containsReplayEvents ||
    s.containsUnitInstances ||
    !s.fullListenerBranchesProven ||
    !s.resourceIdentityPreserved ||
    !s.rigIdentityPreserved ||
    s.submeshVisibilityPreserved ||
    s.meshAcquisitionRecovered ||
    s.nativeReplayAcceptance !== null ||
    s.snapshotRestorationRecovered ||
    s.nativeSnapshotAcceptance !== null ||
    JSON.stringify(metadata.request) !==
      '{"opcode":129,"index":255,"signedIndex":-1,"nativeFlag":false}'
  )
    throw Error("Unsupported negative-form conditional-prefix contract");
  const projection =
    staticCatalog === null
      ? null
      : projectApprovedNegativeCapabilities(
          metadata,
          manifest,
          JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(
              await staticCatalog.readRole("effectsSource"),
            ),
          ),
        );
  const capabilities = new Map();
  for (const c of projection?.accepted ?? metadata.capabilities) {
    const actor = manifest.actors[c.actorKey],
      key = `${c.character}:${c.skinId}`;
    if (
      !actor ||
      actor.character !== c.character ||
      actor.skinId !== c.skinId ||
      actor.skinPath !== c.skinPath ||
      capabilities.has(key)
    )
      throw Error("Negative-form static appearance differs");
    capabilities.set(key, freeze(structuredClone(c)));
  }
  const result = Object.freeze({
    metadata: freeze(structuredClone(metadata)),
    ...(projection === null
      ? {}
      : { selectedCapabilityProjection: freeze(structuredClone(projection)) }),
    classify(hero, request) {
      // Keep malformed/unaccepted provenance failures loud even for callers
      // outside the ordinary prevalidated request track.
      createLatestResourceRequestTrack([request]);
      const c = capabilities.get(`${hero?.champion}:${hero?.skinId}`);
      if (
        !c ||
        c.character !== hero.champion ||
        c.skinId !== hero.skinId ||
        hero.kind !== "hero-creation-candidate" ||
        request.entityId !== hero.entityId ||
        request.opcode !== 129 ||
        request.index !== 255 ||
        request.signedIndex !== -1 ||
        request.nativeFlag !== false
      )
        return null;
      return freeze({
        policy: NEGATIVE_FORM_PREFIX_POLICY,
        status: "conditional-prefix-preserving-request-observation",
        sourceEventId: request.id,
        request: structuredClone(request),
        actorKey: c.actorKey,
        skinSourceSha256: c.skinSourceSha256,
        gearSourceSha256: [...new Set(c.gears.map((g) => g.sourceSha256))],
        resourceIdentityPreserved: true,
        rigIdentityPreserved: true,
        submeshVisibilityPreserved: false,
        snapshotTreatment:
          request.stream === 2
            ? "snapshot-observation-consistent-with-conditional-initial-prefix"
            : null,
        nativeAcceptance: null,
        nativeSnapshotAcceptance: null,
        nativeSnapshotRestoration: null,
        nativePoseParity: null,
        omissions: [...metadata.omissions],
      });
    },
  });
  policies.add(result);
  return result;
}
