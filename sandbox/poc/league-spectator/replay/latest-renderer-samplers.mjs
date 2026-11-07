// Native resource semantics are not necessarily the translated GLSL uniform
// names. Bind every exact sidecar alias; never derive names by replacing text.
export function replaySamplerUniforms(stages, resources) {
  if (!Array.isArray(stages) || !stages.length || !(resources instanceof Map))
    throw Error("Translated stages and owned texture resources required");
  const uniforms = {},
    seen = new Set(),
    aliases = new Map();
  for (const stage of stages) {
    if (!Array.isArray(stage?.sidecar?.textures))
      throw Error("Translated sampler reflection required");
    for (const resource of stage.sidecar.textures) {
      const value = resources.get(resource.name);
      if (!value?.isTexture || !Array.isArray(resource.samplers))
        throw Error(
          `Owned reflected sampler resource missing: ${resource.name}`,
        );
      seen.add(resource.name);
      // The uint-data-texture adapter declares the reflected buffer resource
      // name directly; ordinary texture resources carry explicit sampler names.
      const names =
        resource.dimension === "buffer" && resource.samplers.length === 0
          ? [resource.name]
          : resource.samplers.map((s) => s.glslName);
      if (!names.length)
        throw Error(`Translated sampler aliases missing: ${resource.name}`);
      for (const name of names) {
        if (
          typeof name !== "string" ||
          !/^[_A-Za-z]\w*$/.test(name) ||
          (aliases.has(name) && aliases.get(name) !== resource.name)
        )
          throw Error("Ambiguous or malformed translated sampler alias");
        aliases.set(name, resource.name);
        if (Object.hasOwn(uniforms, name) && uniforms[name].value !== value)
          throw Error("Conflicting reflected sampler resource");
        Object.defineProperty(uniforms, name, {
          value: { value },
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
    }
  }
  if (
    resources.size !== seen.size ||
    [...resources.keys()].some((k) => !seen.has(k))
  )
    throw Error("Unreflected texture resource supplied");
  return uniforms;
}

// This self-contained function is embedded by the pinned renderer producer.
// It reads the actual linked uniform tree without additional GL queries. List
// preparation checks keys; the upload boundary also checks current values.
export function assertReplaySamplerUniforms(
  seq,
  uniforms,
  material,
  program,
  formats,
  valuesRequired = false,
) {
  if (material.isRawShaderMaterial !== true) return;
  const samplerTypes = [
    0x8b5e, 0x8b5f, 0x8b60, 0x8b62, 0x8dc1, 0x8dc4, 0x8dc5, 0x8dca, 0x8dcb,
    0x8dcc, 0x8dcf, 0x8dd2, 0x8dd3, 0x8dd4, 0x8dd7,
  ];
  const hasSampler = (u) =>
    Array.isArray(u.seq)
      ? u.seq.some(hasSampler)
      : samplerTypes.includes(u.type);
  function fail(path, type, reason) {
    throw Error(
      `Replay sampler contract failed: ${JSON.stringify({ materialName: material.name, materialUuid: material.uuid, programId: program.id, source: material.userData?.replayMaterial ?? null, sampler: path.join("."), type: `0x${type.toString(16)}`, reason })}`,
    );
  }
  function own(value, key, path, type) {
    const d =
      value !== null && typeof value === "object"
        ? Object.getOwnPropertyDescriptor(value, key)
        : null;
    if (!d || !Object.hasOwn(d, "value"))
      fail(path, type, "own sampler data required");
    return d.value;
  }
  function texture(value, path, type) {
    if (value?.isTexture !== true)
      fail(path, type, "current texture required before upload");
    if (
      value.isCubeTexture ||
      value.isData3DTexture ||
      value.isDataArrayTexture ||
      value.isCompressedArrayTexture
    )
      fail(path, type, "2D texture target required");
    if (!Number.isInteger(value.format) || !Number.isInteger(value.type))
      fail(path, type, "explicit texture format and type required");
    const integer = formats.integerFormats.includes(value.format);
    if (
      type === 0x8dd2 &&
      (!integer || !formats.unsignedTypes.includes(value.type))
    )
      fail(path, type, "unsigned integer texture format required");
    if (type === 0x8b5e && integer)
      fail(path, type, "floating sampler cannot bind integer texture format");
  }
  function walk(u, value, path) {
    if (Array.isArray(u.seq)) {
      for (const child of u.seq)
        if (hasSampler(child))
          walk(
            child,
            valuesRequired
              ? own(
                  value,
                  child.id,
                  [...path, String(child.id)],
                  child.type ?? 0,
                )
              : null,
            [...path, String(child.id)],
          );
      return;
    }
    if (!samplerTypes.includes(u.type)) return;
    if (u.type !== 0x8b5e && u.type !== 0x8dd2)
      fail(path, u.type, "sampler type has no admitted renderer contract");
    if (!valuesRequired) return;
    if (u.size !== undefined) {
      if (!Array.isArray(value) || value.length !== u.size)
        fail(path, u.type, "exact active sampler array shape required");
      for (let i = 0; i < value.length; i++)
        texture(
          own(value, String(i), [...path, String(i)], u.type),
          [...path, String(i)],
          u.type,
        );
    } else texture(value, path, u.type);
  }
  for (const u of seq) {
    if (!hasSampler(u)) continue;
    const path = [String(u.id)],
      entry = own(uniforms, u.id, path, u.type ?? 0);
    if (entry === null || typeof entry !== "object")
      fail(path, u.type ?? 0, "sampler uniform record required");
    const supplied = own(entry, "value", path, u.type ?? 0);
    if (valuesRequired) {
      const needs = Object.getOwnPropertyDescriptor(entry, "needsUpdate");
      if (needs && (!Object.hasOwn(needs, "value") || needs.value === false))
        fail(path, u.type ?? 0, "active sampler upload cannot be disabled");
    }
    walk(u, valuesRequired ? supplied : null, path);
  }
}
