import {
  readAnimationAsset,
  sampleAnimationFrame,
} from "../../latest-animation.mjs";
import { validateOrdinalModelLayout } from "../ordinal-model-layout.mjs";
import {
  readOrdinalAccessor,
  readOrdinalChampionGlb,
} from "./native-terrain-actors.mjs";

// Three supplies allocation-free matrix and quaternion operations. All asset
// identity and clip selection are supplied by the caller.
export function createOrdinalClipSampler(
  { Matrix4, Vector3, Quaternion },
  modelBytes,
  bindings,
  sourceRig,
  clipBytes,
) {
  const { gltf, binary } = readOrdinalChampionGlb(modelBytes);
  validateOrdinalModelLayout({ bindings, gltf, ...sourceRig });
  const skin = gltf.skins[0];
  const inverse = readOrdinalAccessor(
    gltf,
    binary,
    skin.inverseBindMatrices,
    "MAT4",
    { 5126: 4 },
    16,
  );
  const view = new DataView(
    inverse.data.buffer,
    inverse.data.byteOffset,
    inverse.data.byteLength,
  );
  const inverseBinds = skin.joints.map((_, index) => {
    const start = inverse.offset + index * inverse.stride;
    const entries = Array.from({ length: 16 }, (_, lane) =>
      view.getFloat32(start + lane * 4, true),
    );
    if (!entries.every(Number.isFinite))
      throw Error("Non-finite inverse bind matrix");
    return new Matrix4().fromArray(entries);
  });
  const clip = readAnimationAsset(clipBytes);
  const byId = new Map(
    bindings.joints.map(({ rigId, poseJointIndex }) => [rigId, poseJointIndex]),
  );
  const byNode = new Map(
    bindings.joints.map(({ nodeIndex, poseJointIndex }) => [
      nodeIndex,
      poseJointIndex,
    ]),
  );
  const byOriginalName = new Map();
  const byOriginalHash = new Map();
  function addJointIdentity(index, key, ordinal) {
    index.set(key, index.has(key) ? undefined : ordinal);
  }
  for (const { originalName, poseJointIndex } of bindings.joints) {
    // Only unique original names and stored SKL keys identify a joint.
    addJointIdentity(byOriginalName, originalName, poseJointIndex);
    const { nameHash } = sourceRig.sourceJoints[poseJointIndex];
    if (nameHash !== 0 && nameHash !== undefined)
      addJointIdentity(byOriginalHash, nameHash, poseJointIndex);
  }
  const joints = bindings.joints.map(({ parentRigId, nodeIndex }) => {
    const { matrix, translation, rotation, scale } = gltf.nodes[nodeIndex];
    const position = new Vector3(...(translation ?? [0, 0, 0]));
    const quaternion = new Quaternion(...(rotation ?? [0, 0, 0, 1]));
    const size = new Vector3(...(scale ?? [1, 1, 1]));
    if (matrix)
      new Matrix4().fromArray(matrix).decompose(position, quaternion, size);
    return {
      parent: parentRigId === -1 ? -1 : byId.get(parentRigId),
      position,
      quaternion,
      scale: size,
      local: new Matrix4(),
      world: new Matrix4(),
    };
  });
  const ordered = [];
  const active = new Set();
  const visited = new Set();
  function visit(index) {
    if (visited.has(index)) return;
    if (active.has(index)) throw Error("Cycle in ordinal animation rig");
    active.add(index);
    const joint = joints[index];
    if (joint.parent !== -1) visit(joint.parent);
    active.delete(index);
    visited.add(index);
    ordered.push(joint);
  }
  for (let index = 0; index < joints.length; index++) visit(index);
  const tracks = new Set();
  if (!clip.tracks.length) throw Error("Authored sample has no tracks");
  for (const { jointId, bone, channel } of clip.tracks) {
    const key = `${jointId}:${channel}`;
    if (bindings.joints[jointId]?.originalName !== bone || tracks.has(key))
      throw Error("Authored clip does not match original ordinal joint");
    tracks.add(key);
  }
  const vector = new Vector3();
  const quaternion = new Quaternion();
  const skinMatrix = new Matrix4();
  let sampledFrame = -1;
  function evaluatePose(seconds) {
    if (!Number.isFinite(seconds))
      throw Error("Invalid ordinal animation time");
    const frame = Math.max(0, Math.min(seconds, clip.duration)) * clip.fps;
    if (sampledFrame === frame) return;
    for (const track of clip.tracks) {
      const value = joints[track.jointId][track.channel];
      const { a, b, fraction } = sampleAnimationFrame(track, frame);
      if (track.channel === "quaternion")
        value.fromArray(a).slerp(quaternion.fromArray(b), fraction).normalize();
      else value.fromArray(a).lerp(vector.fromArray(b), fraction);
    }
    for (const joint of ordered) {
      joint.local.compose(joint.position, joint.quaternion, joint.scale);
      if (joint.parent === -1) joint.world.copy(joint.local);
      else
        joint.world.multiplyMatrices(joints[joint.parent].world, joint.local);
    }
    sampledFrame = frame;
  }
  return {
    duration: clip.duration,
    frames: clip.frames,
    fps: clip.fps,
    paletteSize: skin.joints.length,
    trackCount: tracks.size,
    sample(seconds, palette = new Float32Array(skin.joints.length * 16)) {
      if (
        !(palette instanceof Float32Array) ||
        palette.length !== skin.joints.length * 16
      )
        throw Error("Invalid ordinal animation sample");
      evaluatePose(seconds);
      for (const [index, node] of skin.joints.entries()) {
        skinMatrix.multiplyMatrices(
          joints[byNode.get(node)].world,
          inverseBinds[index],
        );
        skinMatrix.toArray(palette, index * 16);
      }
      return palette;
    },
    // The joint frame is cumulative in model space, before inverse bind.
    // Copy to caller-owned storage so later renders and seeks cannot alter it.
    copyJointModelFrame(seconds, identity, target) {
      let ordinal = identity;
      if (typeof identity === "string") ordinal = byOriginalName.get(identity);
      if (identity && typeof identity === "object")
        ordinal = byOriginalHash.get(identity.nameHash);
      if (
        !Number.isSafeInteger(ordinal) ||
        ordinal < 0 ||
        ordinal >= joints.length
      )
        return false;
      evaluatePose(seconds);
      target.copy(joints[ordinal].world);
      return true;
    },
  };
}
