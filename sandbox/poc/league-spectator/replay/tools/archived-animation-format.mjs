export function archivedAnimationFormat(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 40)
    throw Error("Bounded original animation header required");
  const magic = new TextDecoder().decode(bytes.subarray(0, 8));
  const version = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(8, true);
  if (magic === "r3d2canm" && version === 1)
    return { magic, version, evaluator: "original-native-compressed-v1" };
  if (magic === "r3d2anmd" && [3, 4, 5].includes(version))
    return { magic, version, evaluator: "pinned-toolkit-uncompressed" };
  throw Error(`Unadmitted original animation format ${magic}/${version}`);
}

export function completeActorAnimationCatalog(plan, completed) {
  if (
    !Array.isArray(plan.records) ||
    !Array.isArray(plan.rigJoints) ||
    !plan.rigJoints.length
  )
    throw Error("Source-bound animation format plan required");
  const clips = {};
  for (const source of plan.records) {
    const resource = completed.get(source.sourceSha256);
    if (
      !resource ||
      resource.evaluator !== source.evaluator ||
      !Number.isSafeInteger(resource.frames) ||
      resource.frames <= 0 ||
      !Number.isFinite(resource.fps) ||
      resource.fps <= 0 ||
      !Number.isFinite(resource.duration) ||
      resource.duration < 0 ||
      !/^[a-f\d]{64}$/.test(resource.sha256)
    )
      throw Error(
        `Required animation has no admitted complete export: ${source.file}`,
      );
    for (const name of source.names) {
      if (Object.hasOwn(clips, name))
        throw Error("Duplicate original animation catalog identity");
      clips[name] = {
        file: source.outputFile,
        duration: resource.duration,
        fps: resource.fps,
        frames: resource.frames,
        sha256: resource.sha256,
        evaluator: resource.evaluator,
      };
    }
  }
  return {
    schema: 1,
    sampling:
      "Original-native compressed-v1 frames; pinned Toolkit uncompressed frames (native interpolation comparison remains separate)",
    joints: plan.rigJoints,
    clips,
  };
}
