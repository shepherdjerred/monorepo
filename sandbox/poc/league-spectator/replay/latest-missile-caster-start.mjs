// Bounded source-start translation for the owned zero-reference family.
// Callers bind the supplied rig and replay world root; native match state
// and live render-model readiness remain separate acceptance boundaries.
import { VIEWER_ROOT_POLICY } from "./latest-world-presentation.mjs";

export const EMPTY_BONE_CASTER_START_POLICY =
  "supplied-viewer-root-empty-bone-terrain-start-v1";
const f = Math.fround;
const vector = (value) =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every((lane) => Number.isFinite(lane) && Number.isFinite(f(lane)));
const uint = (value) =>
  Number.isInteger(value) && value >= 0 && value <= 0xffffffff;

export function initializeEmptyBoneCasterStart({
  record,
  settings,
  sourceBoneName,
  root,
  rig,
  terrain,
}) {
  if (
    !record?.cast ||
    !uint(record.cast.ownerId) ||
    record.cast.ownerId === 0 ||
    !Number.isFinite(record.time) ||
    !Number.isInteger(settings?.castType) ||
    !vector(settings.particleStartOffset) ||
    typeof sourceBoneName !== "string" ||
    typeof record.cast.forceRecordedSourcePosition !== "boolean" ||
    !Number.isInteger(record.cast.overrideFlag14d) ||
    record.cast.overrideFlag14d < 0 ||
    record.cast.overrideFlag14d > 255 ||
    typeof terrain?.sampleHeight !== "function"
  )
    throw Error("Typed caster-start inputs required");
  const reasons = [];
  if (record.cast.forceRecordedSourcePosition)
    reasons.push("start:recorded-source-branch-is-separate");
  if (record.cast.overrideFlag14d !== 0)
    reasons.push("start:override-branch-unadmitted");
  if (settings.castType !== 1) reasons.push("start:cast-type-one-required");
  if (settings.particleStartOffset.some((lane) => lane !== 0))
    reasons.push("start:nonzero-local-offset-untranslated");
  if (sourceBoneName !== "")
    reasons.push("start:named-bone-selection-untranslated");
  if (
    !rig ||
    rig.build !== "16.21.829.8620" ||
    rig.protocol !== "20e09df23c66b85e" ||
    !/^[a-f0-9]{64}$/.test(rig.rigSha256) ||
    !Array.isArray(rig.resolvedBoneKeys) ||
    !rig.resolvedBoneKeys.length ||
    !rig.resolvedBoneKeys.every(uint)
  )
    throw Error(
      "Explicit source-pinned constructed rig key inventory required",
    );
  if (rig.resolvedBoneKeys.includes(0))
    reasons.push("start:empty-bone-key-present-in-rig");
  if (
    !root?.resolved ||
    root.policy !== VIEWER_ROOT_POLICY ||
    root.entityId !== record.cast.ownerId ||
    root.time !== record.time ||
    !vector(root.position) ||
    root.lifecycle !== "alive" ||
    ![
      "movement-derived-preview",
      "recorded-creation-position",
      "recorded-respawn-point",
    ].includes(root.positionStatus)
  )
    reasons.push("start:matching-actual-source-root-unresolved");
  if (reasons.length)
    return {
      resolved: false,
      policy: EMPTY_BONE_CASTER_START_POLICY,
      status: "unresolved-caster-terrain-bone-seed",
      position: null,
      reasons,
    };
  const ground = terrain.sampleHeight(f(root.position[0]), f(root.position[2]));
  if (
    typeof ground.inside !== "boolean" ||
    (ground.inside && !Number.isFinite(ground.height))
  )
    throw Error("Typed terrain query required");
  return {
    resolved: true,
    policy: EMPTY_BONE_CASTER_START_POLICY,
    status: "initialized",
    settings: structuredClone(settings),
    groundRebase: false,
    overrideBypass: false,
    localOffset: [0, 0, 0],
    position: [
      f(root.position[0]),
      f(f(ground.inside ? ground.height : 0) + 100),
      f(root.position[2]),
    ],
    planeHeightOffset: 0,
    attachmentHeightOffset: 0,
    groundHeightStatus: ground.inside
      ? "navgrid"
      : "outside-navgrid-native-zero",
    sourceRoot: structuredClone(root),
    rigSha256: rig.rigSha256,
    nativeAcceptance: null,
    nativePlacementParity: null,
    omissions: [
      ...(root.omissions ?? []),
      "start:native-live-render-model-and-dynamic-bone-state-unrecovered",
    ],
    reasons: [],
  };
}
