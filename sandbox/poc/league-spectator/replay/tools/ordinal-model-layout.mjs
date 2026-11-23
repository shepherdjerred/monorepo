// Original joint order and parent IDs are authoritative. Rendering node names
// are unique implementation IDs; attachment name/hash lookup stays separate.
export function readOriginalRigOrdinalSource(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 64)
    throw Error("Bounded original modern rig bytes required");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) !== 0x22fd4fc3 || view.getUint32(8, true) !== 0)
    throw Error("Unadmitted original ordinal rig format");
  const count = view.getUint16(14, true),
    paletteCount = view.getUint32(16, true),
    jointOffset = view.getInt32(20, true),
    paletteOffset = view.getInt32(28, true);
  if (
    !count ||
    count > 4096 ||
    !paletteCount ||
    paletteCount > 256 ||
    jointOffset < 64 ||
    jointOffset + count * 100 > bytes.length ||
    paletteOffset < 64 ||
    paletteOffset + paletteCount * 2 > bytes.length
  )
    throw Error("Original rig ordinal/palette bounds differ");
  const sourceJoints = [];
  for (let index = 0; index < count; index++) {
    const at = jointOffset + index * 100,
      nameStart = at + 96 + view.getInt32(at + 96, true);
    if (nameStart < 0 || nameStart >= bytes.length)
      throw Error("Original joint name offset out of bounds");
    let end = nameStart;
    while (end < bytes.length && end - nameStart <= 1024 && bytes[end] !== 0)
      end++;
    if (end >= bytes.length || end === nameStart || end - nameStart > 1024)
      throw Error("Bounded original joint name required");
    sourceJoints.push({
      rigId: view.getInt16(at + 2, true),
      parentId: view.getInt16(at + 4, true),
      name: new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(nameStart, end),
      ),
    });
  }
  return {
    sourceJoints,
    sourcePalette: Array.from({ length: paletteCount }, (_, index) =>
      view.getInt16(paletteOffset + index * 2, true),
    ),
  };
}

export function validateOrdinalModelLayout({
  bindings,
  gltf,
  sourceJoints,
  sourcePalette,
}) {
  if (
    bindings?.schema !== 1 ||
    bindings.kind !== "original-rig-ordinal-model-bindings" ||
    !Array.isArray(sourceJoints) ||
    !sourceJoints.length ||
    !Array.isArray(sourcePalette) ||
    !sourcePalette.length ||
    bindings.joints?.length !== sourceJoints.length ||
    bindings.palette?.length !== sourcePalette.length ||
    gltf.skins?.length !== 1
  )
    throw Error("Complete original ordinal model layout required");
  const skin = gltf.skins[0],
    meshNodes = gltf.nodes.flatMap((node, index) =>
      node.skin === 0 && Number.isInteger(node.mesh) ? [index] : [],
    );
  if (
    meshNodes.length !== 1 ||
    skin.joints.length !== sourcePalette.length ||
    gltf.accessors?.[skin.inverseBindMatrices]?.count !== sourcePalette.length
  )
    throw Error("Original skin palette coverage differs");
  const byId = new Map();
  for (let index = 0; index < sourceJoints.length; index++) {
    const joint = sourceJoints[index];
    if (byId.has(joint.rigId)) throw Error("Duplicate original rig ID");
    byId.set(joint.rigId, index);
  }
  const parents = new Map();
  for (let index = 0; index < gltf.nodes.length; index++)
    for (const child of gltf.nodes[index].children ?? []) {
      if (
        !Number.isSafeInteger(child) ||
        child < 0 ||
        child >= gltf.nodes.length ||
        parents.has(child)
      )
        throw Error("Invalid model node parent graph");
      parents.set(child, index);
    }
  const nodeIds = new Set(),
    names = new Set();
  for (let ordinal = 0; ordinal < sourceJoints.length; ordinal++) {
    const source = sourceJoints[ordinal],
      entry = bindings.joints[ordinal];
    if (
      entry.poseJointIndex !== ordinal ||
      entry.rigId !== source.rigId ||
      entry.parentRigId !== source.parentId ||
      entry.originalName !== source.name ||
      !Number.isSafeInteger(entry.nodeIndex) ||
      entry.nodeIndex < 0 ||
      nodeIds.has(entry.nodeIndex) ||
      entry.nodeName !== `scout_joint_${ordinal}` ||
      names.has(entry.nodeName) ||
      gltf.nodes[entry.nodeIndex]?.name !== entry.nodeName
    )
      throw Error("Model omitted or aliased an original joint ordinal");
    nodeIds.add(entry.nodeIndex);
    names.add(entry.nodeName);
    const parentOrdinal = byId.get(source.parentId),
      expectedParent =
        source.parentId === -1
          ? meshNodes[0]
          : bindings.joints[parentOrdinal]?.nodeIndex;
    if (
      expectedParent === undefined ||
      parents.get(entry.nodeIndex) !== expectedParent
    )
      throw Error("Original ordinal joint parent mapping differs");
  }
  for (let index = 0; index < sourcePalette.length; index++) {
    const id = sourcePalette[index],
      ordinal = byId.get(id),
      entry = bindings.palette[index];
    if (
      ordinal === undefined ||
      entry.paletteIndex !== index ||
      entry.rigId !== id ||
      entry.poseJointIndex !== ordinal ||
      entry.nodeIndex !== bindings.joints[ordinal].nodeIndex ||
      skin.joints[index] !== entry.nodeIndex
    )
      throw Error("Original SKN influence palette order differs");
  }
  if (
    bindings.vertexSkinning?.weightBitDifferences !== 0 ||
    bindings.vertexSkinning?.sourceWeightedJointIdsSha256 !==
      bindings.vertexSkinning?.exportedWeightedJointIdsSha256 ||
    !/^[a-f\d]{64}$/.test(bindings.vertexSkinning?.sourceWeightedJointIdsSha256)
  )
    throw Error("Original weighted vertex joint mapping proof differs");
  return {
    jointNodeIndices: bindings.joints.map((joint) => joint.nodeIndex),
    paletteJointOrdinals: bindings.palette.map((joint) => joint.poseJointIndex),
  };
}
