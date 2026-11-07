import {
  EFFECT_ENTITY_FIELDS,
  VIEWER_ROOT_POLICY,
} from "./latest-world-presentation.mjs";
import { createLatestRootAttachmentProviderKernels } from "./latest-root-attachment-provider.mjs";
import { createLatestPacketDirectionBasis } from "./latest-packet-direction-basis.mjs";
import { directAttachmentComponentAdmitted } from "./latest-direct-effect-placement-consumers.mjs";
import { resolveLatestViewerBoundSizePlacement } from "./latest-viewer-bound-size.mjs";

export const VIEWER_ROOT_ATTACHMENT_POLICY =
  "viewer-root-key-zero-without-source-matrix-v1";
const uint = (value) =>
  Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const vector = (value) =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every((n) => Number.isFinite(n) && Number.isFinite(Math.fround(n)));

// Policy selection precedes resolution. This does not retry a failed native
// provider using a viewer point. The source remains the registered actor and
// the root input explicitly retains the actor's provisional movement status.
export function createLatestViewerRootAttachmentPlacement({
  profile,
  packetPlacement,
  definitions,
}) {
  const kernels = createLatestRootAttachmentProviderKernels(profile);
  const directionBasis = createLatestPacketDirectionBasis(profile);
  if (
    packetPlacement?.metadata?.policy !==
      "packet-position-without-transform-providers" ||
    packetPlacement.metadata.build !== profile.clientVersion ||
    packetPlacement.metadata.protocol !== profile.protocolDigest ||
    packetPlacement.metadata.decoderImageSha256 !==
      profile.decoderImageSha256 ||
    typeof packetPlacement.resolve !== "function" ||
    !(definitions instanceof Map)
  )
    throw Error(
      "Exact packet-placement policy and compiled definitions required",
    );
  return Object.freeze({
    metadata: Object.freeze({
      ...packetPlacement.metadata,
      attachmentPolicy: VIEWER_ROOT_ATTACHMENT_POLICY,
      nativeAttachmentLookupExecuted: false,
      nativePlacementParity: null,
    }),
    resolve(input) {
      const { event, references, world, time, cursor } = input;
      const d = event.descriptor;
      if (!d || !uint(d.attachmentEntityId))
        throw Error("Canonical source attachment identity required");
      if (d.attachmentEntityId === 0) return packetPlacement.resolve(input);
      if (!Array.isArray(references) || references.length !== 4)
        throw Error("All four original effect references required");
      const reasons = [];
      for (const field of EFFECT_ENTITY_FIELDS) {
        const ref = references.find((r) => r.field === field);
        if (
          !uint(d[field]) ||
          !ref ||
          ref.entityId !== d[field] ||
          (d[field] === 0 &&
            (ref.entity !== null || ref.status !== "native-null")) ||
          (ref.entity &&
            (ref.entity.entityId !== d[field] ||
              ref.status !== "registered")) ||
          (d[field] !== 0 &&
            !ref.entity &&
            (ref.entity !== null ||
              !["inactive", "unresolved"].includes(ref.status)))
        )
          throw Error(
            "Viewer-root reference differs from original descriptor identity",
          );
        if (d[field] && !ref.entity)
          reasons.push(
            `world:${ref.status === "inactive" ? "inactive" : "unresolved"}-reference:${field}:${d[field]}`,
          );
      }
      if (
        !uint(d.flags) ||
        !uint(d.field8c) ||
        !uint(d.attachmentKey4c) ||
        !uint(d.attachmentKey50) ||
        !uint(d.byteFields?.field98) ||
        d.byteFields.field98 > 255 ||
        d.coordinateSpace !== "native-world" ||
        d.packetVectorsResolved !== true ||
        !vector(d.primaryPacketPosition) ||
        !vector(d.secondaryPacketVector) ||
        !vector(d.vector6c)
      )
        throw Error("Finite canonical viewer-root descriptor fields required");
      if (d.field8c !== 0) reasons.push("world:nonordinary-placement-factory");
      if (d.attachmentKey4c !== 0)
        reasons.push(`world:bone-source-provider:${d.attachmentKey4c}`);
      if (d.lookup14EntityId !== 0)
        reasons.push(
          `world:target-transform-provider:${d.lookup14EntityId}:${d.attachmentKey50}`,
        );
      if (
        d.lookupA8EntityId !== 0 &&
        d.lookupA8EntityId !== d.attachmentEntityId
      )
        reasons.push(
          `world:additional-transform-provider:${d.lookupA8EntityId}`,
        );
      if (d.byteFields.field98 !== 0)
        reasons.push("world:special-source-transform-provider");
      if ((d.flags & ~0xb0) !== 0)
        reasons.push(
          `world:untranslated-placement-flags:${(d.flags & ~0xb0) >>> 0}`,
        );
      if (d.vector6c[1] !== 0)
        reasons.push("world:nonhorizontal-authored-placement-direction-basis");
      const wrapperFlags =
        (d.flags & 0x10 ? 0 : 1) |
        (d.flags & 0x20 ? 2 : 0) |
        (d.flags & 0x80 ? 4 : 0);
      const objectFlags = kernels.mapWrapperFlags(wrapperFlags, 0);
      if (kernels.requiresSourceMatrix(objectFlags))
        reasons.push("world:source-transform-provider-matrix-required");
      const definition = definitions.get(event.definitionId);
      if (!definition || definition.blockers?.length)
        reasons.push(
          "world:viewer-root-definition-root-capabilities-unresolved",
        );
      else
        for (const emitter of definition.emitters)
          if (!directAttachmentComponentAdmitted(definition, emitter))
            reasons.push(
              `world:viewer-root-component-not-admitted:${emitter.index}:${emitter.primitive}`,
            );
      if (reasons.length)
        return {
          resolved: false,
          references,
          policy: VIEWER_ROOT_ATTACHMENT_POLICY,
          reasons,
        };
      if (typeof world?.viewerRoot !== "function")
        throw Error("Explicit shared viewer-root input required");
      const root = world.viewerRoot(d.attachmentEntityId, time, cursor);
      if (root.policy !== VIEWER_ROOT_POLICY)
        throw Error("Viewer root policy differs");
      if (!root.resolved)
        return {
          resolved: false,
          references,
          policy: VIEWER_ROOT_ATTACHMENT_POLICY,
          reasons: [...root.reasons],
        };
      if (
        root.entityId !== d.attachmentEntityId ||
        !vector(root.position) ||
        root.nativeAcceptance !== null ||
        root.nativePlacementParity !== null
      )
        throw Error("Explicit viewer-root ownership/status differs");
      return resolveLatestViewerBoundSizePlacement(
        {
          resolved: true,
          references,
          policy: VIEWER_ROOT_ATTACHMENT_POLICY,
          position: kernels.copyRootPosition(0, root.position),
          secondaryPosition: d.secondaryPacketVector.map(Math.fround),
          basis: directionBasis.horizontal(d.vector6c),
          basisStatus: d.vector6c.some((n) => n !== 0)
            ? "authored-horizontal-packet-basis-source-matrix-inheritance-disabled"
            : "constructor-basis-source-matrix-inheritance-disabled",
          nativeParentFlags: objectFlags,
          rootInput: structuredClone(root),
          reasons: [
            ...root.omissions,
            "world:independent-provider-direction-not-consumed-by-admitted-quads",
            "world:wrapper-visibility-and-culling",
            "lifecycle:source-provider-death-revive-parent-activation-unimplemented",
            "lifecycle:network-stop-reset-and-tail-semantics",
          ],
        },
        input,
        definition,
      );
    },
  });
}
