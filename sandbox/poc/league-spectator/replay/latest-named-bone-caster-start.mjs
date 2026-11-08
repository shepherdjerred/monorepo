// Bounded original type1/type3 start math over an owned viewer bone pose.
// The caller binds raw installed rig/catalog bytes and the causal pose view.
// This does not establish the original live render-model query's readiness.
import { VIEWER_ROOT_POLICY } from "./latest-world-presentation.mjs";
import { VIEWER_POSE_POLICY } from "./latest-viewer-pose-sampler.mjs";

export const NAMED_BONE_CASTER_START_POLICY =
  "supplied-viewer-named-bone-type3-terrain-start-v1";
export const NAMED_BONE_TYPE_ONE_CASTER_START_POLICY =
  "supplied-viewer-named-bone-type1-terrain-start-v1";
const f = Math.fround;
const uint = (value) =>
  Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const vector = (value) =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every((lane) => Number.isFinite(lane) && Number.isFinite(f(lane)));

export function initializeNamedBoneCasterStart(inputs) {
  return initializeNamedBoneStart(inputs, 3, NAMED_BONE_CASTER_START_POLICY);
}
export function initializeNamedBoneTypeOneCasterStart(inputs) {
  return initializeNamedBoneStart(
    inputs,
    1,
    NAMED_BONE_TYPE_ONE_CASTER_START_POLICY,
  );
}
function initializeNamedBoneStart(
  { record, settings, sourceBoneName, root, rig, pose, terrain },
  castType,
  policy,
) {
  if (
    !record?.cast ||
    !uint(record.cast.ownerId) ||
    !record.cast.ownerId ||
    !Number.isFinite(record.time) ||
    !Number.isSafeInteger(record.transportSequence) ||
    record.transportSequence < 0 ||
    !Number.isSafeInteger(record.entryOrder ?? 0) ||
    (record.entryOrder ?? 0) < 0 ||
    !Number.isInteger(settings?.castType) ||
    !vector(settings.particleStartOffset) ||
    !vector(record.cast.sourcePosition) ||
    typeof sourceBoneName !== "string" ||
    typeof record.cast.forceRecordedSourcePosition !== "boolean" ||
    !uint(record.cast.overrideFlag14d) ||
    record.cast.overrideFlag14d > 255 ||
    typeof terrain?.sampleHeight !== "function"
  )
    throw Error("Typed original named-bone start inputs required");
  if (
    rig?.build !== "16.21.829.8620" ||
    rig.protocol !== "20e09df23c66b85e" ||
    !/^[a-f0-9]{64}$/.test(rig.rigSha256) ||
    typeof rig.actorKey !== "string" ||
    !uint(rig.binding?.resolvedBoneKey) ||
    !uint(rig.binding.nativePoseIndex) ||
    !uint(rig.binding.keyPoseIndex) ||
    typeof rig.binding.name !== "string" ||
    (castType === 3
      ? rig.binding.name !== sourceBoneName
      : rig.binding.name.toLowerCase() !== sourceBoneName.toLowerCase())
  )
    throw Error("Source-bound installed named rig binding required");
  const reasons = [];
  if (record.cast.forceRecordedSourcePosition)
    reasons.push("start:recorded-source-branch-is-separate");
  if (record.cast.overrideFlag14d !== 0)
    reasons.push("start:override-branch-unadmitted");
  if (settings.castType !== castType)
    reasons.push(
      castType === 3
        ? "start:cast-type-three-required"
        : "start:cast-type-one-required",
    );
  if (settings.particleStartOffset.some((lane) => lane !== 0))
    reasons.push("start:nonzero-local-offset-untranslated");
  if (
    !sourceBoneName.length ||
    !rig.binding.resolvedBoneKey ||
    rig.binding.keyPoseIndex !== rig.binding.nativePoseIndex
  )
    reasons.push("start:named-key-pose-namespace-unresolved");
  if (
    !root?.resolved ||
    root.policy !== VIEWER_ROOT_POLICY ||
    root.entityId !== record.cast.ownerId ||
    root.time !== record.time ||
    !vector(root.position) ||
    root.lifecycle !== "alive"
  )
    reasons.push("start:matching-actual-source-root-unresolved");
  if (!pose?.resolved)
    reasons.push(
      ...(pose?.reasons ?? ["start:actual-source-named-pose-unresolved"]),
    );
  else if (
    pose.policy !== VIEWER_POSE_POLICY ||
    pose.entityId !== record.cast.ownerId ||
    pose.time !== record.time ||
    pose.poseEvidence?.actorKey !== rig.actorKey ||
    pose.poseEvidence.staticHashes?.rig !== rig.rigSha256 ||
    pose.poseEvidence.cursor?.transportSequence !== record.transportSequence ||
    pose.poseEvidence.cursor.entryOrder !== (record.entryOrder ?? 0) ||
    pose.poseEvidence.cursor.exclusive === true
  )
    reasons.push("start:matching-causal-owned-named-pose-required");
  const bone = pose?.attachments?.find(
    (bone) => bone?.key === rig.binding.resolvedBoneKey,
  );
  if (
    pose?.resolved &&
    (!bone ||
      bone.name !== rig.binding.name ||
      bone.nativePoseIndex !== rig.binding.keyPoseIndex ||
      !vector(bone.position))
  )
    reasons.push("start:matching-installed-named-bone-unresolved");
  if (reasons.length)
    return {
      resolved: false,
      policy,
      status: "unresolved-caster-terrain-bone-seed",
      position: null,
      reasons: [...new Set(reasons)],
    };
  const rootPosition = root.position.map(f),
    bonePosition = bone.position.map(f);
  const rootGround = terrain.sampleHeight(rootPosition[0], rootPosition[2]),
    boneGround =
      castType === 3
        ? terrain.sampleHeight(bonePosition[0], bonePosition[2])
        : null;
  for (const ground of [
    rootGround,
    ...(boneGround === null ? [] : [boneGround]),
  ])
    if (
      typeof ground.inside !== "boolean" ||
      (ground.inside && !Number.isFinite(ground.height))
    )
      throw Error("Typed original terrain input required");
  const rootBaseline = f(f(rootGround.inside ? rootGround.height : 0) + 100);
  const attachmentHeightOffset = f(bonePosition[1] - rootBaseline);
  const planeHeightOffset =
    castType === 3
      ? f(bonePosition[1] - f(boneGround.inside ? boneGround.height : 0))
      : 0;
  return {
    resolved: true,
    policy,
    status: "initialized",
    settings: structuredClone(settings),
    groundRebase: castType === 3,
    overrideBypass: false,
    localOffset: [0, 0, 0],
    position:
      castType === 1
        ? bonePosition
        : [
            f(record.cast.sourcePosition[0]),
            f(planeHeightOffset + f(record.cast.sourcePosition[1])),
            f(record.cast.sourcePosition[2]),
          ],
    planeHeightOffset,
    attachmentHeightOffset,
    sourceRoot: structuredClone(root),
    sourcePose: structuredClone(pose),
    sourceBoneName,
    bonePosition,
    rigSha256: rig.rigSha256,
    boneKey: rig.binding.resolvedBoneKey,
    rootGroundHeightStatus: rootGround.inside
      ? "navgrid"
      : "outside-navgrid-native-zero",
    boneGroundHeightStatus:
      boneGround === null
        ? "not-queried"
        : boneGround.inside
          ? "navgrid"
          : "outside-navgrid-native-zero",
    nativeAcceptance: null,
    nativePlacementParity: null,
    omissions: [
      ...new Set([
        ...(root.omissions ?? []),
        ...(pose.poseEvidence.omissions ?? []),
        "start:supplied-viewer-bone-pose-not-recovered-native-match-state",
        "start:native-live-render-model-ready-and-bone-query-state-unrecovered",
      ]),
    ],
    reasons: [],
  };
}
