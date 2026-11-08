// Pure, build-package animation graph subset. Unknown nodes remain explicit.
import { sampleDualClockAnimationPoseFrame } from "./latest-animation-pose-time-domain.mjs";
export function animationHash(name) {
  let hash = 2166136261;
  for (const character of name.toLowerCase())
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return `{${hash.toString(16).padStart(8, "0")}}`;
}
function table(entries) {
  const lookup = new Map();
  for (const [name, value] of Object.entries(entries)) {
    const key = name.startsWith("{") ? name.toLowerCase() : animationHash(name);
    if (lookup.has(key)) throw Error(`Duplicate animation hash ${key}`);
    lookup.set(key, { name, value });
  }
  return (name) =>
    lookup.get(name.startsWith("{") ? name.toLowerCase() : animationHash(name));
}
export function createAnimationGraph(graph, catalog, clock) {
  if (catalog.schema !== 1 || !Array.isArray(catalog.joints))
    throw Error("Unsupported atomic animation catalog");
  if (typeof clock?.evaluate !== "function")
    throw Error("Atomic graph requires a matching native clock binding");
  const definitions = Object.values(graph).filter(
    (g) => g.__type === "AnimationGraphData",
  );
  if (definitions.length !== 1)
    throw Error("Expected one skin animation graph");
  const data = definitions[0],
    clips = table(data.mClipDataMap),
    masks = table(data.mMaskDataMap ?? {}),
    tracks = table(data.mTrackDataMap);
  const atomic = table(catalog.clips);
  function find(name) {
    return clips(name);
  }
  function dependencies(name, seen = new Set()) {
    const item = find(name);
    if (!item || seen.has(item.name)) return [];
    seen.add(item.name);
    const node = item.value;
    if (node.__type === "AtomicClipData") {
      const asset = atomic(item.name);
      if (!asset) throw Error(`Missing atomic animation asset ${item.name}`);
      return [asset.value.file];
    }
    const children = [
      ...(node.mClipNameList ?? []),
      ...[node.mTrueConditionClipName, node.mFalseConditionClipName].filter(
        Boolean,
      ),
      ...(node.mParametricPairDataList ?? []).map((v) => v.mClipName),
      ...(node.mSelectorPairDataList ?? []).map((v) => v.mClipName),
      ...(node.mConditionFloatPairDataList ?? []).map((v) => v.mClipName),
    ];
    return [...new Set(children.flatMap((child) => dependencies(child, seen)))];
  }
  function evaluate(name, elapsed, context, parents = new Set()) {
    const item = find(name);
    const unknown = (reason) => ({
      leaves: [],
      duration: null,
      unresolved: [{ name, reason }],
    });
    if (!item) return unknown("Animation graph name is absent");
    if (parents.has(item.name))
      return unknown("Cyclic animation graph reference");
    const next = new Set(parents);
    next.add(item.name);
    const node = item.value;
    if (node.__type === "AtomicClipData") {
      const asset = atomic(item.name);
      if (!asset) throw Error(`Atomic clip not prepared: ${item.name}`);
      const trackName = node.mTrackDataName ?? "Default",
        track = tracks(trackName);
      if (!track) throw Error(`Missing animation track ${trackName}`);
      if ((track.value.mBlendMode ?? 0) !== 0)
        return unknown(
          `Track blend mode ${track.value.mBlendMode} unimplemented`,
        );
      const mask = node.mMaskDataName ? masks(node.mMaskDataName) : null;
      if (node.mMaskDataName && !mask)
        throw Error(`Missing animation mask ${node.mMaskDataName}`);
      const weights = mask?.value.mWeightList;
      if (weights && !weights.every(Number.isFinite))
        throw Error(`Non-finite bone weights ${node.mMaskDataName}`);
      if (weights && weights.length !== catalog.joints.length)
        return unknown(
          `Mask ${node.mMaskDataName} has ${weights.length} weights for ${catalog.joints.length} joints; remapping unimplemented`,
        );
      if (weights && weights.some((w) => w < 0 || w > 1))
        return unknown(
          `Mask ${node.mMaskDataName} has weights outside the implemented unit interval`,
        );
      const timing = clock.evaluate(item.name, elapsed),
        duration = timing.duration;
      if (!Number.isFinite(duration) || duration < 0)
        throw Error("Invalid atomic animation duration");
      return {
        duration,
        unresolved: [],
        leaves:
          elapsed >= 0 && elapsed < duration
            ? [
                {
                  name: item.name,
                  file: asset.value.file,
                  phase: timing.poseTime,
                  sourceFrame: asset.value.poseTimeDomain
                    ? sampleDualClockAnimationPoseFrame(
                        timing.poseTime,
                        asset.value,
                      )
                    : Math.fround(
                        timing.poseTime * Math.fround(asset.value.fps),
                      ),
                  eventFrame: timing.frame,
                  weights,
                  track: track.name,
                  priority: track.value.mPriority ?? 0,
                  weight: track.value.mBlendWeight ?? 1,
                  events: node.mEventDataMap ?? {},
                  flags: node.mFlags ?? 0,
                },
              ]
            : [],
      };
    }
    if (
      node.__type === "ConditionBoolClipData" &&
      node.Updater?.__type === "IsMovingParametricUpdater"
    )
      return evaluate(
        context.moving
          ? node.mTrueConditionClipName
          : node.mFalseConditionClipName,
        elapsed,
        context,
        next,
      );
    if (
      node.__type === "ParametricClipData" &&
      node.Updater?.__type === "IsMovingParametricUpdater"
    ) {
      const pair = node.mParametricPairDataList?.find(
        (p) => (p.mValue ?? 0) === (context.moving ? 1 : 0),
      );
      return pair
        ? evaluate(pair.mClipName, elapsed, context, next)
        : unknown("Missing discrete movement branch");
    }
    if (node.__type === "ParallelClipData") {
      const results = node.mClipNameList.map((child) =>
        evaluate(child, elapsed, context, next),
      );
      return {
        leaves: results.flatMap((r) => r.leaves),
        unresolved: results.flatMap((r) => r.unresolved),
        duration: results.some((r) => r.duration === null)
          ? null
          : Math.max(...results.map((r) => r.duration)),
      };
    }
    if (node.__type === "SequencerClipData") {
      let offset = 0;
      const leaves = [],
        unresolved = [];
      for (const child of node.mClipNameList) {
        const result = evaluate(child, elapsed - offset, context, next);
        if (result.duration === null)
          return { ...result, leaves: [], duration: null };
        if (elapsed >= offset && elapsed < offset + result.duration)
          leaves.push(...result.leaves);
        unresolved.push(...result.unresolved);
        offset += result.duration;
      }
      return { leaves, unresolved, duration: offset };
    }
    return unknown(
      `${node.__type} / ${node.Updater?.__type ?? "no updater"} unimplemented`,
    );
  }
  return { find, dependencies, evaluate };
}

// Interpolation is deterministic at an absolute replay time; no frame-step history.
export function sampleAnimationTrack(track, fps, phase) {
  return sampleAnimationFrame(track, phase * fps);
}
export function sampleAnimationFrame(track, sourceFrame) {
  if (!Number.isFinite(sourceFrame))
    throw Error("Invalid animation source frame");
  const frame = Math.max(0, Math.min(track.count - 1, sourceFrame)),
    a = Math.floor(frame),
    b = Math.min(a + 1, track.count - 1);
  return {
    a: track.values.subarray(a * track.width, (a + 1) * track.width),
    b: track.values.subarray(b * track.width, (b + 1) * track.width),
    fraction: frame - a,
  };
}
export function readAnimationAsset(buffer) {
  const view = new DataView(buffer);
  if (buffer.byteLength < 4) throw Error("Truncated animation asset");
  const size = view.getUint32(0, true);
  if (size < 2 || size > buffer.byteLength - 4)
    throw Error("Animation header out of bounds");
  const header = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(
      new Uint8Array(buffer, 4, size),
    ),
  );
  const bytes = buffer.slice(4 + size);
  if (
    bytes.byteLength % 4 ||
    header.schema !== 1 ||
    !Number.isFinite(header.fps) ||
    header.fps <= 0 ||
    !Number.isFinite(header.duration) ||
    header.duration <= 0 ||
    !Number.isInteger(header.frames) ||
    header.frames < 1 ||
    !Array.isArray(header.tracks)
  )
    throw Error("Invalid atomic animation asset");
  for (const track of header.tracks) {
    if (
      !["position", "scale", "quaternion"].includes(track.channel) ||
      track.width !== (track.channel === "quaternion" ? 4 : 3) ||
      ![1, header.frames].includes(track.count) ||
      !Number.isSafeInteger(track.offset) ||
      track.offset < 0 ||
      track.offset % 4 ||
      track.offset + track.count * track.width * 4 > bytes.byteLength ||
      !Number.isSafeInteger(track.jointId) ||
      track.jointId < 0 ||
      typeof track.bone !== "string"
    )
      throw Error("Invalid atomic animation track");
    track.values = new Float32Array(
      bytes,
      track.offset,
      track.count * track.width,
    );
    if (!track.values.every(Number.isFinite))
      throw Error("Non-finite animation keyframe");
  }
  return header;
}
