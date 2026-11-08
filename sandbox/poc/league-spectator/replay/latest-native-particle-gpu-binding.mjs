// GPU bindings from complete native material observations. Unsupported scene
// resources remain explicit omissions; malformed prepared inputs fail.
const decodeHex = (value) => {
  if (typeof value !== "string" || !/^(?:[a-f0-9]{2})*$/.test(value))
    throw Error("Exact particle byte hex required");
  return Uint8Array.from(value.match(/../g) ?? [], (s) => parseInt(s, 16));
};
const encodeHex = (bytes) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
export function nativeParticleGpuOmissions(
  emitter,
  needsErosionDrive,
  hasColorBinding = false,
  vertexErosion = false,
) {
  const reasons = [];
  for (const key of [
    "alphaErosionDefinition",
    "paletteDefinition",
    "reflectionDefinition",
  ])
    if (emitter[key] && !(key === "alphaErosionDefinition" && vertexErosion))
      reasons.push(`unbound-resource:${key}`);
  if (emitter.particleColorTexture && !hasColorBinding)
    reasons.push("unbound-resource:particleColorTexture");
  if (needsErosionDrive && !vertexErosion) reasons.push("live-erosion-drive");
  if (vertexErosion && !emitter.alphaErosionDefinition?.erosionMapName)
    reasons.push("unbound-default-erosion-texture");
  if (!emitter.texture) reasons.push("unbound-default-base-texture");
  if (emitter.textureMult && !emitter.textureMult.textureMult)
    reasons.push("unbound-default-mult-texture");
  return reasons;
}

export async function prepareNativeParticleGpuBinding(n, record, context) {
  const {
    effects,
    shaderPackage,
    pairs,
    assets,
    read,
    raw,
    sha,
    inputs,
    stages,
    colorBindings,
    vertexErosion = false,
  } = context;
  const emitter =
      record.definition.complexEmitterDefinitionData[n.emitterIndex],
    colorBinding = colorBindings?.get(`${n.effectId}:${n.emitterIndex}`),
    reasons = nativeParticleGpuOmissions(
      emitter,
      n.needsErosionDrive,
      !!colorBinding,
      vertexErosion,
    );
  if (
    vertexErosion &&
    (!emitter.alphaErosionDefinition || !n.needsErosionDrive)
  )
    throw Error("Vertex erosion requires an authored erosion material");
  if (
    colorBinding &&
    (colorBinding.graphSha256 !== n.sha256 ||
      colorBinding.sourceDefinitionSha256 !== n.sourceDefinitionSha256 ||
      colorBinding.authoredPath !== emitter.particleColorTexture)
  )
    throw Error("Native particle color graph/definition differs");
  if (reasons.length) {
    return {
      omitted: {
        effectId: n.effectId,
        emitterIndex: n.emitterIndex,
        reasons,
      },
    };
  }
  const family = shaderPackage.pairs.find(
    (p) =>
      p.vertex === n.selection.vertex.toLowerCase() &&
      p.pixel === n.selection.pixel.toLowerCase(),
  );
  if (!family) throw Error("Unprepared particle shader family");
  const declared = new Map(
    pairs.groups
      .find((g) => g.name === family.name)
      .declares.map((d) => [d.name, d.value]),
  );
  // ALPHA_TEST is a native render-state define. The prepared shader TOC
  // identifies which defines participate in its permutation key, as in the
  // existing quad adapter. Retain the complete native define list as evidence.
  const defines = n.renderState.defines
      .filter((d) => declared.get(d.name) === d.value)
      .sort((a, b) => a.name.localeCompare(b.name)),
    candidates = pairs.programs.filter(
      (p) =>
        p.family === family.name &&
        JSON.stringify(p.defines) === JSON.stringify(defines),
    );
  if (candidates.length !== 1)
    throw Error("Unprepared/ambiguous particle permutation");
  const pair = candidates[0],
    shaderSources = [];
  for (const stage of ["vertex", "pixel"]) {
    const s = await read(`${assets}/latest-shaders/${pair[stage].file}`);
    if (
      inputs[`${assets}/latest-shaders/${pair[stage].file}`] !==
      pair[stage].sha256
    )
      throw Error("Particle shader changed");
    shaderSources.push(s);
  }
  const parameters = new Map(
      [...n.parameters, ...n.renderState.uniforms].map((p) => [p.name, p]),
    ),
    blocks = [],
    textures = {};
  const missingInputs = [];
  for (const shader of shaderSources) {
    for (const block of shader.sidecar.blocks)
      for (const member of block.members)
        if (
          member.used &&
          !parameters.has(member.name) &&
          ![
            "mProj",
            "vCamera",
            "RENDERTARGET_IS_SRGB",
            "DEBUG_RENDERTARGET_IS_SRGB_HANDLED",
            ...(vertexErosion ? ["USE_INSTANCE_DRAW"] : []),
          ].includes(member.name)
        )
          missingInputs.push(
            `unbound-uniform:${block.glslName}.${member.name}`,
          );
    for (const texture of shader.sidecar.textures)
      if (
        ![
          "TEXTURE__TX",
          "TEXTUREMULT__TX",
          "PARTICLE_COLOR_TEXTURE__TX",
          "PIXEL_COLOR_REMAP_RAMP_SharedTexture",
          ...(vertexErosion ? ["sAlphaErosionTexture__TX"] : []),
        ].includes(texture.name)
      )
        missingInputs.push(`unbound-texture:${texture.name}`);
  }
  if (missingInputs.length)
    return {
      omitted: {
        effectId: n.effectId,
        emitterIndex: n.emitterIndex,
        reasons: [...new Set(missingInputs)],
      },
    };
  for (const shader of shaderSources) {
    for (const block of shader.sidecar.blocks) {
      const bytes = new Uint8Array(block.size),
        sceneMembers = [];
      for (const member of block.members) {
        if (!member.used) continue;
        const p = parameters.get(member.name);
        if (p) {
          const b = decodeHex(p.bytesHex);
          if (member.scalar !== "float" || member.size > b.length)
            throw Error("Particle uniform width/type differs");
          bytes.set(b.subarray(0, member.size), member.offset);
        } else if (
          vertexErosion &&
          block.name === "VFXDynamicPerParticleInstanceCBPS" &&
          member.name === "USE_INSTANCE_DRAW" &&
          member.scalar === "uint" &&
          member.size === 4
        ) {
          // Original batched primitive draw sets USE_INSTANCE_DRAW to one
          // at 173d8e5..173d8f1. Quad writers already pack each live drive
          // into the fourth half of a_TEXCOORD; the shader selects that lane.
          new DataView(bytes.buffer).setUint32(member.offset, 1, true);
        } else if (
          (member.name === "mProj" &&
            member.scalar === "float" &&
            member.size === 64 &&
            member.rows === 4 &&
            member.columns === 4 &&
            !member.rowMajor) ||
          (member.name === "vCamera" &&
            member.scalar === "float" &&
            member.size === 12)
        ) {
          sceneMembers.push({
            name: member.name,
            offset: member.offset,
            size: member.size,
          });
        } else if (
          [
            "RENDERTARGET_IS_SRGB",
            "DEBUG_RENDERTARGET_IS_SRGB_HANDLED",
          ].includes(member.name) &&
          ["uint", "bool"].includes(member.scalar) &&
          member.size === 4
        ) {
          new DataView(bytes.buffer).setUint32(member.offset, 0, true);
        } else
          throw Error(
            `Unprovided particle uniform: ${block.glslName}.${member.name}`,
          );
      }
      blocks.push({
        glslName: block.glslName,
        size: block.size,
        bytesHex: encodeHex(bytes),
        sceneMembers,
      });
    }
    for (const t of shader.sidecar.textures) {
      let binding;
      if (
        ["TEXTURE__TX", "TEXTUREMULT__TX"].includes(t.name) ||
        (t.name === "PARTICLE_COLOR_TEXTURE__TX" && colorBinding) ||
        (vertexErosion && t.name === "sAlphaErosionTexture__TX")
      ) {
        const layer =
            t.name === "sAlphaErosionTexture__TX"
              ? "erosion"
              : t.name === "PARTICLE_COLOR_TEXTURE__TX"
                ? "color"
                : t.name === "TEXTURE__TX"
                  ? "base"
                  : "mult",
          path =
            layer === "base"
              ? emitter.texture
              : layer === "color"
                ? emitter.particleColorTexture
                : layer === "erosion"
                  ? emitter.alphaErosionDefinition.erosionMapName
                  : emitter.textureMult?.textureMult,
          asset = effects.assets[path?.toLowerCase()],
          sampler =
            layer === "color"
              ? colorBinding
              : n.samplers.find((s) => s.layer === layer);
        if (
          !asset ||
          asset.status !== "prepared" ||
          asset.kind !== "texture" ||
          !sampler
        )
          throw Error(
            `Unprepared particle texture/sampler: ${n.effectId}:${n.emitterIndex} ${layer} ${path} ${JSON.stringify(asset)}`,
          );
        if (
          layer === "color" &&
          ["file", "sha256", "sourceSha256", "width", "height"].some(
            (key) => colorBinding.asset[key] !== asset[key],
          )
        )
          throw Error("Native particle color texture identity differs");
        const descriptor = [...decodeHex(sampler.descriptorHex)];
        if (
          descriptor.length !== 5 ||
          descriptor.slice(0, 3).some((v) => v > 3) ||
          descriptor.slice(3).some((v) => v > 1)
        )
          throw Error("Invalid native particle sampler descriptor");
        if (
          descriptor.slice(0, 3).some((v) => v !== descriptor[0]) ||
          descriptor[3] !== descriptor[4] ||
          descriptor[0] > 2 ||
          descriptor[3] > 1
        )
          return {
            omitted: {
              effectId: n.effectId,
              emitterIndex: n.emitterIndex,
              reasons: [
                `unimplemented-native-sampler:${layer}:${sampler.descriptorHex}`,
              ],
            },
          };
        if (
          (await sha(await raw(`${assets}/latest-effects/${asset.file}`))) !==
          asset.sha256
        )
          throw Error("Particle texture changed");
        binding = {
          kind: "prepared-texture",
          file: asset.file,
          sha256: asset.sha256,
          sampler: {
            name: ["repeat", "clamp", "mirror"][descriptor[0]],
            pixelated: !descriptor[3],
          },
          nativeSamplerHex: sampler.descriptorHex,
        };
      } else if (t.name === "PARTICLE_COLOR_TEXTURE__TX")
        binding = { kind: "supplied-white-lookup" };
      else if (t.name === "PIXEL_COLOR_REMAP_RAMP_SharedTexture")
        binding = { kind: "supplied-transparent-remap" };
      else throw Error(`Unprovided particle texture: ${t.name}`);
      for (const s of t.samplers) {
        if (!s.sampler || Object.hasOwn(textures, s.glslName))
          throw Error("Ambiguous particle sampler");
        textures[s.glslName] = binding;
      }
    }
  }
  const factors = [...decodeHex(n.renderState.bytesHex)].slice(10, 14);
  if (factors.some((v) => ![1, 6, 7].includes(v)))
    return {
      omitted: {
        effectId: n.effectId,
        emitterIndex: n.emitterIndex,
        reasons: [`unimplemented-native-blend:${factors.join(",")}`],
      },
    };
  for (const stage of ["vertex", "pixel"])
    stages.set(pair[stage].sha256, pair[stage]);
  return {
    binding: {
      effectId: n.effectId,
      emitterIndex: n.emitterIndex,
      graphSha256: n.sha256,
      sourceDefinitionSha256: n.sourceDefinitionSha256,
      environment: n.environment,
      nativeDefines: n.renderState.defines,
      defines,
      family: family.name,
      shaders: { vertex: pair.vertex, pixel: pair.pixel },
      blocks,
      textures,
      nativeRenderStateHex: n.renderState.bytesHex,
      nativeBlendFactors: factors,
      suppliedDepthTest: !(emitter.miscRenderFlags & 1),
      suppliedDoubleSide: !!emitter.disableBackfaceCull,
      suppliedSortPass: emitter.pass ?? 0,
      ...(vertexErosion ? { erosionInput: "native-quad-texcoord-w" } : {}),
    },
  };
}
