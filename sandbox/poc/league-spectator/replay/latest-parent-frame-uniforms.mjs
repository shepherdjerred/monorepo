// Pack original draw-prefix bytes into reflected shader blocks. Matrices have
// already passed through the original setter: never transpose them again here.
const bytesFromHex = (text) => {
  if (typeof text !== "string" || !/^(?:[a-f0-9]{2})+$/.test(text))
    throw Error("Exact captured constant bytes required");
  return Uint8Array.from(text.match(/../g), (x) => parseInt(x, 16));
};
export function packParentReflectedVectors(block, vectors) {
  if (
    !block ||
    !Number.isSafeInteger(block.size) ||
    block.size <= 0 ||
    block.size > 65536 ||
    !Array.isArray(block.members) ||
    !Array.isArray(vectors)
  )
    throw Error("Bounded reflected block and ordered vector sources required");
  const sources = new Map();
  for (const v of vectors) {
    if (
      !v ||
      typeof v.name !== "string" ||
      !(v.bytes instanceof Uint8Array) ||
      !v.bytes.length ||
      v.bytes.length % 16
    )
      throw Error("Owned whole-vector uniform bytes required");
    if (!sources.has(v.name)) sources.set(v.name, v.bytes);
  }
  const bytes = new Uint8Array(block.size),
    copied = [],
    occupied = new Uint8Array(block.size);
  for (const m of block.members) {
    if (!m.used) continue;
    if (
      !Number.isSafeInteger(m.offset) ||
      !Number.isSafeInteger(m.size) ||
      m.offset < 0 ||
      m.size <= 0 ||
      m.offset + m.size > bytes.length ||
      occupied.subarray(m.offset, m.offset + m.size).some(Boolean)
    )
      throw Error("Reflected uniform members overlap or exceed block");
    occupied.fill(1, m.offset, m.offset + m.size);
    const source = sources.get(m.name);
    if (!source) throw Error(`Unprovided frame uniform: ${m.name}`);
    const count = Math.min(source.length, m.size);
    bytes.set(source.subarray(0, count), m.offset);
    copied.push({ name: m.name, offset: m.offset, bytes: count });
  }
  return { bytes, copied };
}

export function parentFrameUniformBlocks(
  selection,
  stages,
  parameters,
  sceneValues,
) {
  if (
    selection?.status !== "prepared-native-parent-material" ||
    parameters?.emitterIndex !== selection.emitterIndex ||
    parameters.passHash !== selection.passHash ||
    !parameters.values ||
    !Array.isArray(stages) ||
    stages.length !== 2 ||
    !sceneValues ||
    typeof sceneValues !== "object"
  )
    throw Error(
      "Matching owned material, draw parameters, shader stages and explicit scene bytes required",
    );
  const variant = selection.variant,
    constants = new Map(variant.constantBuffers.map((b) => [b.name, b])),
    required = new Map(
      variant.requiredScene.blocks.map((b) => [`${b.stage}:${b.name}`, b]),
    ),
    result = [];
  for (const [i, shader] of stages.entries()) {
    const stage = ["vertex", "pixel"][i];
    if (!shader?.sidecar || !Array.isArray(shader.sidecar.blocks))
      throw Error("Verified translated shader reflection required");
    for (const block of shader.sidecar.blocks) {
      if (!block.members.some((m) => m.used)) continue;
      if (
        shader.sidecar.textures.some(
          (t) => t.name === block.name && t.dimension === "buffer",
        )
      )
        throw Error(`Unprovided frame data buffer: ${block.name}`);
      const captured = constants.get(block.glslName);
      if (captured) {
        if (captured.stage !== stage)
          throw Error("Captured constant stage differs");
        if (
          block.members.some(
            (m) => m.used && Object.hasOwn(parameters.values, m.name),
          )
        )
          throw Error(
            "Shared draw parameter collides with a material constant",
          );
        const bytes = bytesFromHex(captured.bytesHex);
        if (bytes.length !== block.size)
          throw Error("Captured constant block size differs");
        result.push({
          stage,
          name: block.glslName,
          binding: captured.binding,
          bytes,
          source: "captured-native-material",
          copied: [],
        });
        continue;
      }
      const ref = required.get(`${stage}:${block.glslName}`);
      if (!ref || ref.size !== block.size)
        throw Error("Unowned reflected frame block");
      const vectors = [];
      for (const m of block.members.filter((m) => m.used)) {
        const native = parameters.values[m.name];
        if (native !== undefined && Object.hasOwn(sceneValues, m.name))
          throw Error(`Scene overrides original draw parameter: ${m.name}`);
        const bytes =
          typeof native === "string"
            ? bytesFromHex(native)
            : (native ?? sceneValues[m.name]);
        if (bytes === undefined)
          throw Error(`Unprovided frame uniform: ${m.name}`);
        vectors.push({ name: m.name, bytes });
      }
      const packed = packParentReflectedVectors(block, vectors);
      result.push({
        stage,
        name: block.glslName,
        binding: ref.binding,
        ...packed,
        source: "original-draw-and-explicit-scene",
      });
    }
  }
  if (result.length !== constants.size + required.size)
    throw Error("Shader frame packing omitted a bound block");
  return result;
}
