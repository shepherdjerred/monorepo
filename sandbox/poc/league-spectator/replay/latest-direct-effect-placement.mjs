import { sha256 } from "./structural-comparison.mjs";
import { WORLD_DESCRIPTOR_ABI_SHA } from "./latest-world-descriptor-abi.mjs";
import { EFFECT_ENTITY_FIELDS } from "./latest-world-presentation.mjs";
import { createLatestPacketDirectionBasis } from "./latest-packet-direction-basis.mjs";
import { createLatestAdditionalAudioAnchorPolicy } from "./latest-additional-audio-anchor.mjs";
import { createLatestProviderFreeBoundSize } from "./latest-provider-free-bound-size.mjs";

const uint = (value) =>
  Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const vector = (value, size) =>
  Array.isArray(value) &&
  value.length === size &&
  value.every(
    (lane) => Number.isFinite(lane) && Number.isFinite(Math.fround(lane)),
  );
const requiredBlocks = Object.freeze([
  [0x83e2d7, 0x83e2f4], // The ordinary resource helper receives descriptor+54.
  [0x83e8c4, 0x83e8d3], // An attachment selects a transform-provider branch.
  [0x83eaf1, 0x83eafe], // Null-attachment special provider flag.
  [0x83edfa, 0x83ee36], // Terrain alignment and authored direction branches.
  [0x83f07e, 0x83f08e], // A target entity selects a transform provider.
  [0x83f147, 0x83f163], // Otherwise descriptor+60 supplies the secondary point.
  [0x36b680, 0x36b6b3], // Original secondary-point setter.
  [0x83f2d7, 0x83f2e4], // A distinct A8 entity selects an additional provider.
]);
function covered(blocks, start, end) {
  let cursor = start;
  for (const block of [...blocks].sort((a, b) => a.rva - b.rva)) {
    if (block.rva > cursor) break;
    if (block.rva + block.size > cursor) cursor = block.rva + block.size;
    if (cursor >= end) return true;
  }
  return false;
}

// The original factory's packet-position branch uses its constructor basis or
// the verified horizontal packet direction setter before parent activation.
// Entity/resource ownership remains present; this does not erase references or
// turn an unresolved attached request into a detached presentation.
export async function createLatestDirectEffectPlacement({
  profile,
  packageBytes,
}) {
  if ((await sha256(packageBytes)) !== WORLD_DESCRIPTOR_ABI_SHA)
    throw Error("Pinned original world descriptor factory policy required");
  const meta = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(packageBytes),
  );
  if (
    meta.schema !== 1 ||
    meta.kind !== "prepared-detached-world-descriptor-abi" ||
    meta.build !== "16.21.829.8620" ||
    meta.protocol !== "20e09df23c66b85e" ||
    meta.build !== profile.clientVersion ||
    meta.protocol !== profile.protocolDigest ||
    meta.decoderImageSha256 !== profile.decoderImageSha256 ||
    !meta.scope.staticBuildDataOnly ||
    meta.scope.containsReplayEvents ||
    !meta.scope.completeOriginalDescriptorFactory ||
    !meta.scope.explicitDetachedDescriptors ||
    meta.scope.entityBoneAttachments ||
    meta.scope.replayWorldStateRecovered ||
    requiredBlocks.some(
      ([start, end]) => !covered(meta.sourceBlocks, start, end),
    )
  )
    throw Error("Unsupported direct packet-placement build/contract");
  const directionBasis = createLatestPacketDirectionBasis(profile);
  const auxiliaryAudio = createLatestAdditionalAudioAnchorPolicy(profile);
  const boundSize = createLatestProviderFreeBoundSize(profile);
  const metadata = Object.freeze({
    build: meta.build,
    protocol: meta.protocol,
    decoderImageSha256: meta.decoderImageSha256,
    factoryPackageSha256: WORLD_DESCRIPTOR_ABI_SHA,
    policy: "packet-position-without-transform-providers",
    horizontalPacketDirectionTranslated: true,
    entityPoseProvidersTranslated: false,
    auxiliaryAudioAnchorPolicy: auxiliaryAudio.policy,
    providerFreeBoundObjectSize: boundSize.boundObjectSize,
  });
  return Object.freeze({
    metadata,
    resolve({ event, references }) {
      const d = event.descriptor;
      if (!d || !Array.isArray(references) || references.length !== 4)
        throw Error(
          "Canonical effect descriptor and all four world references required",
        );
      const reasons = [];
      for (const field of EFFECT_ENTITY_FIELDS) {
        const reference = references.find(
          (reference) => reference.field === field,
        );
        if (!reference || !uint(d[field]) || reference.entityId !== d[field])
          throw Error(
            "Placement world reference differs from original descriptor",
          );
        if (
          (d[field] === 0 &&
            (reference.entity !== null ||
              reference.status !== "native-null")) ||
          (reference.entity &&
            (reference.entity.entityId !== d[field] ||
              reference.status !== "registered"))
        )
          throw Error(
            "Placement reference has inconsistent world identity/status",
          );
        if (d[field] !== 0 && !reference.entity)
          reasons.push(
            `world:${reference.status === "inactive" ? "inactive" : "unresolved"}-reference:${field}:${d[field]}`,
          );
      }
      if (reasons.length) return { resolved: false, references, reasons };
      if (
        d.coordinateSpace !== "native-world" ||
        d.packetVectorsResolved !== true ||
        !vector(d.primaryPacketPosition, 3) ||
        !vector(d.secondaryPacketVector, 3) ||
        !vector(d.vector6c, 3) ||
        !uint(d.flags) ||
        !uint(d.field8c) ||
        !uint(d.attachmentKey4c) ||
        !uint(d.attachmentKey50) ||
        !uint(d.byteFields?.field98) ||
        d.byteFields.field98 > 255
      )
        throw Error(
          "Finite native packet placement vectors and flags required",
        );
      if (d.field8c !== 0) reasons.push("world:nonordinary-placement-factory");
      if (d.attachmentEntityId !== 0)
        reasons.push(
          `world:source-transform-provider:${d.attachmentEntityId}:${d.attachmentKey4c}`,
        );
      if (d.lookup14EntityId !== 0)
        reasons.push(
          `world:target-transform-provider:${d.lookup14EntityId}:${d.attachmentKey50}`,
        );
      let auxiliaryOmissions = [];
      const hasAuxiliaryAudioAnchor =
        d.lookupA8EntityId !== 0 && d.lookupA8EntityId !== d.attachmentEntityId;
      if (hasAuxiliaryAudioAnchor) {
        const auxiliary = auxiliaryAudio.inspect(
          references.find(
            (reference) => reference.field === "lookupA8EntityId",
          ),
        );
        if (!auxiliary.allowed) reasons.push(...auxiliary.reasons);
        else auxiliaryOmissions = auxiliary.reasons;
      }
      if (d.byteFields.field98 !== 0)
        reasons.push("world:special-source-transform-provider");
      if (d.flags & 0x40) reasons.push("world:terrain-aligned-placement-basis");
      if (Math.fround(d.vector6c[1]) !== 0)
        reasons.push("world:nonhorizontal-authored-placement-direction-basis");
      if ((d.flags & ~0xb0) !== 0)
        reasons.push(
          `world:untranslated-placement-flags:${(d.flags & ~0xb0) >>> 0}`,
        );
      if (reasons.length) return { resolved: false, references, reasons };
      return {
        resolved: true,
        references,
        position: d.primaryPacketPosition.map(Math.fround),
        secondaryPosition: d.secondaryPacketVector.map(Math.fround),
        basis: directionBasis.horizontal(d.vector6c),
        basisStatus: d.vector6c.some((lane) => lane !== 0)
          ? "original-provider-free-horizontal-packet-direction-basis"
          : "original-provider-free-constructor-basis",
        policy: hasAuxiliaryAudioAnchor
          ? auxiliaryAudio.policy
          : metadata.policy,
        ...boundSize,
        nativeParentFlags:
          (d.flags & 0x10 ? 0 : 0x10) |
          (d.flags & 0x20 ? 2 : 0) |
          (d.flags & 0x80 ? 0x20 : 0),
        // These are omissions in the surrounding presentation lifecycle,
        // not guessed replacements for its verified placement/birth slice.
        reasons: [
          "world:wrapper-visibility-and-culling",
          "lifecycle:network-stop-reset-and-tail-semantics",
          ...auxiliaryOmissions,
        ],
      };
    },
  });
}
