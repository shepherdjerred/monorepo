import { EFFECT_ENTITY_FIELDS } from "./latest-world-presentation.mjs";
import { createLatestViewerRootAttachmentPlacement } from "./latest-viewer-root-attachment.mjs";
import { createLatestRootAttachmentProviderKernels } from "./latest-root-attachment-provider.mjs";
import { createLatestPacketDirectionBasis } from "./latest-packet-direction-basis.mjs";
import { VIEWER_POSE_POLICY } from "./latest-viewer-pose-sampler.mjs";
import { directAttachmentComponentAdmitted } from "./latest-direct-effect-placement-consumers.mjs";
import { isDirectImmutableData } from "./latest-direct-immutable-data.mjs";
import { resolveLatestViewerBoundSizePlacement } from "./latest-viewer-bound-size.mjs";
export const VIEWER_POSE_ATTACHMENT_POLICY =
  "same-viewer-installed-pose-attachment-partial-v1";
const uint = (value) =>
  Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const vector = (value, size) =>
  Array.isArray(value) &&
  value.length === size &&
  Array.from(value).every(
    (n) => Number.isFinite(n) && Number.isFinite(Math.fround(n)),
  );
export function createLatestViewerPoseAttachmentPlacement({
  profile,
  packetPlacement,
  definitions,
}) {
  const root = createLatestViewerRootAttachmentPlacement({
      profile,
      packetPlacement,
      definitions,
    }),
    kernels = createLatestRootAttachmentProviderKernels(profile),
    directions = createLatestPacketDirectionBasis(profile);
  const composedEvidence = new WeakMap(),
    absentEvidence = Object.freeze({});
  function poseEvidence(source, target, presentationContentHash) {
    const a = source?.poseEvidence ?? null,
      b = target?.poseEvidence ?? null;
    const immutable = isDirectImmutableData(a) && isDirectImmutableData(b);
    const key = a ?? absentEvidence,
      peer = b ?? absentEvidence;
    let peers = immutable ? composedEvidence.get(key) : null;
    const previous = peers?.get(peer);
    if (
      previous &&
      previous.presentationContentHash === presentationContentHash
    )
      return previous;
    const result = {
      policy: VIEWER_POSE_POLICY,
      presentationContentHash,
      source: a,
      target: b,
      nativeAcceptance: null,
      nativePoseParity: null,
    };
    if (immutable) {
      Object.freeze(result);
      if (!peers) composedEvidence.set(key, (peers = new WeakMap()));
      peers.set(peer, result);
    }
    return result;
  }
  return Object.freeze({
    metadata: Object.freeze({
      ...root.metadata,
      attachmentPolicy: VIEWER_POSE_ATTACHMENT_POLICY,
      posePolicy: VIEWER_POSE_POLICY,
      nativePoseParity: null,
    }),
    resolve(input) {
      const { event, references, world, time, cursor } = input,
        d = event.descriptor;
      if (
        !d ||
        !uint(d.attachmentEntityId) ||
        !uint(d.lookup14EntityId) ||
        !uint(d.flags) ||
        !uint(d.attachmentKey4c)
      )
        throw Error("Canonical pose attachment descriptor required");
      const flags = kernels.mapWrapperFlags(
          (d.flags & 0x10 ? 0 : 1) |
            (d.flags & 0x20 ? 2 : 0) |
            (d.flags & 0x80 ? 4 : 0),
          0,
        ),
        matrixRequired = kernels.requiresSourceMatrix(flags);
      // Select this explicit presentation policy before any resolution attempt.
      // The existing proven key-zero/matrix-skip branch remains unchanged.
      if (
        !d.lookup14EntityId &&
        (!d.attachmentEntityId || (d.attachmentKey4c === 0 && !matrixRequired))
      )
        return root.resolve(input);
      if (!Array.isArray(references) || references.length !== 4)
        throw Error("All four pose attachment references required");
      const reasons = [];
      for (const field of EFFECT_ENTITY_FIELDS) {
        const ref = references.find((value) => value.field === field);
        if (
          !uint(d[field]) ||
          !ref ||
          ref.entityId !== d[field] ||
          (d[field] === 0 &&
            (ref.status !== "native-null" || ref.entity !== null)) ||
          (ref.entity &&
            (ref.entity.entityId !== d[field] ||
              ref.status !== "registered")) ||
          (d[field] !== 0 &&
            !ref.entity &&
            (ref.entity !== null ||
              !["inactive", "unresolved"].includes(ref.status)))
        )
          throw Error("Pose attachment reference identity differs");
        if (d[field] && !ref.entity)
          reasons.push(`world:${ref.status}-reference:${field}:${d[field]}`);
      }
      if (
        !uint(d.field8c) ||
        !uint(d.attachmentKey50) ||
        !uint(d.byteFields?.field98) ||
        d.byteFields.field98 > 255 ||
        d.coordinateSpace !== "native-world" ||
        d.packetVectorsResolved !== true ||
        !vector(d.primaryPacketPosition, 3) ||
        !vector(d.secondaryPacketVector, 3) ||
        !vector(d.vector6c, 3)
      )
        throw Error("Finite canonical pose attachment vectors/flags required");
      if (d.field8c) reasons.push("world:nonordinary-placement-factory");
      if (d.byteFields.field98)
        reasons.push("world:special-source-transform-provider");
      if (d.flags & ~0xb0)
        reasons.push(
          `world:untranslated-placement-flags:${(d.flags & ~0xb0) >>> 0}`,
        );
      if (d.vector6c[1] !== 0)
        reasons.push("world:nonhorizontal-authored-placement-direction-basis");
      if (d.lookupA8EntityId && d.lookupA8EntityId !== d.attachmentEntityId)
        reasons.push(
          `world:additional-transform-provider:${d.lookupA8EntityId}`,
        );
      const definition = definitions.get(event.definitionId);
      if (!definition || definition.blockers.length)
        reasons.push(
          "world:viewer-pose-definition-root-capabilities-unresolved",
        );
      else
        for (const emitter of definition.emitters)
          if (!directAttachmentComponentAdmitted(definition, emitter))
            reasons.push(
              `world:viewer-pose-component-not-admitted:${emitter.index}:${emitter.primitive}`,
            );
      if (reasons.length)
        return {
          resolved: false,
          policy: VIEWER_POSE_ATTACHMENT_POLICY,
          references,
          reasons,
        };
      if (typeof world?.viewerPose !== "function")
        throw Error("Explicit same-viewer pose service required");
      const query = (entityId, key) =>
        entityId ? world.viewerPose(entityId, [key], time, cursor) : null;
      const source = query(d.attachmentEntityId, d.attachmentKey4c),
        target = query(d.lookup14EntityId, d.attachmentKey50);
      for (const [kind, result] of [
        ["source", source],
        ["target", target],
      ])
        if (result && !result.resolved)
          reasons.push(
            ...result.reasons.map((reason) => `world:${kind}:${reason}`),
          );
      if (reasons.length)
        return {
          resolved: false,
          policy: VIEWER_POSE_ATTACHMENT_POLICY,
          references,
          reasons,
        };
      for (const [id, key, result] of [
        [d.attachmentEntityId, d.attachmentKey4c, source],
        [d.lookup14EntityId, d.attachmentKey50, target],
      ])
        if (
          result &&
          (result.policy !== VIEWER_POSE_POLICY ||
            result.entityId !== id ||
            result.nativeAcceptance !== null ||
            result.nativePoseParity !== null ||
            result.attachments.length !== 1 ||
            result.attachments[0].key !== key ||
            !vector(result.attachments[0].position, 3) ||
            !vector(result.attachments[0].basis, 9) ||
            result.poseEvidence.presentationContentHash !==
              world.presentationContentHash)
        )
          throw Error("Same-viewer pose source identity/evidence differs");
      return resolveLatestViewerBoundSizePlacement(
        {
          resolved: true,
          policy: VIEWER_POSE_ATTACHMENT_POLICY,
          references,
          position: (
            source?.attachments[0].position ?? d.primaryPacketPosition
          ).map(Math.fround),
          secondaryPosition: (
            target?.attachments[0].position ?? d.secondaryPacketVector
          ).map(Math.fround),
          basis: (d.attachmentEntityId && matrixRequired
            ? source.attachments[0].basis
            : directions.horizontal(d.vector6c)
          ).map(Math.fround),
          basisStatus:
            d.attachmentEntityId && matrixRequired
              ? "same-viewer-unit-quaternion-basis-native-pose-parity-unknown"
              : "authored-packet-basis-source-matrix-inheritance-disabled",
          nativeParentFlags: flags,
          poseEvidence: poseEvidence(
            source,
            target,
            world.presentationContentHash,
          ),
          reasons: [
            ...new Set([
              ...(source?.reasons ?? []),
              ...(target?.reasons ?? []),
              "world:independent-provider-direction-not-consumed-by-admitted-quads",
              "world:wrapper-visibility-and-culling",
              "lifecycle:source-provider-death-revive-parent-activation-unimplemented",
              "lifecycle:network-stop-reset-and-tail-semantics",
              "world:attached-bound-object-size-unknown",
            ]),
          ],
        },
        input,
        definition,
      );
    },
  });
}
