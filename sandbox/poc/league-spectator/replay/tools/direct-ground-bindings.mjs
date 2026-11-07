// Complete only the two scene inputs rejected by the unchanged shared GPU
// preparer. Static textures are reused by identity; shaders and pipeline state
// always come from the original ground pass5 selection.
export function completeNativeGroundBinding({
  n,
  result,
  shaders,
  pair,
  defines,
  family,
  previous,
  policy,
  emitter,
}) {
  const expected = [
    "unbound-texture:FOW_MAP_SharedTexture",
    "unbound-uniform:PerFrameVertexCB_vs.FOG_OF_WAR_PARAMS",
  ].sort();
  if (
    !result.omitted ||
    JSON.stringify([...result.omitted.reasons].sort()) !==
      JSON.stringify(expected) ||
    previous.effectId !== n.effectId ||
    previous.emitterIndex !== n.emitterIndex ||
    previous.sourceDefinitionSha256 !== n.sourceDefinitionSha256 ||
    previous.graphSha256 !== n.sha256 ||
    n.environment.pass !== 5
  )
    throw Error(
      "Ground completion requires exactly the proven FoW resource boundary",
    );
  const parameters = new Map(n.parameters.map((p) => [p.name, p.bytesHex]));
  parameters.set("FOG_OF_WAR_PARAMS", policy.uniformBytesHex);
  const blocks = [],
    textures = {};
  for (const shader of shaders) {
    for (const block of shader.sidecar.blocks) {
      const bytes = new Uint8Array(block.size),
        sceneMembers = [];
      for (const member of block.members) {
        if (!member.used) continue;
        if (parameters.has(member.name)) {
          const value = Uint8Array.from(
            Buffer.from(parameters.get(member.name), "hex"),
          );
          if (member.scalar !== "float" || value.length < member.size)
            throw Error("Ground native uniform width/type differs");
          bytes.set(value.subarray(0, member.size), member.offset);
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
        )
          sceneMembers.push({
            name: member.name,
            offset: member.offset,
            size: member.size,
          });
        else if (
          [
            "RENDERTARGET_IS_SRGB",
            "DEBUG_RENDERTARGET_IS_SRGB_HANDLED",
          ].includes(member.name) &&
          ["uint", "bool"].includes(member.scalar) &&
          member.size === 4
        )
          new DataView(bytes.buffer).setUint32(member.offset, 0, true);
        else
          throw Error(
            `Unprovided ground uniform: ${block.glslName}.${member.name}`,
          );
      }
      blocks.push({
        glslName: block.glslName,
        size: block.size,
        bytesHex: Buffer.from(bytes).toString("hex"),
        sceneMembers,
      });
    }
    for (const texture of shader.sidecar.textures) {
      let binding;
      if (texture.name === "FOW_MAP_SharedTexture")
        binding = {
          kind: "native-ground-all-vision",
          rgbaHex: policy.rgbaHex,
          nativeTextureSha256: policy.nativeTextureSha256,
          nativeProofSha256: policy.nativeProofSha256,
          sampler: { name: "clamp", pixelated: true },
        };
      else {
        const candidates = texture.samplers.map(
          (s) => previous.textures[s.glslName],
        );
        binding = candidates[0];
        if (
          !binding ||
          candidates.some((b) => JSON.stringify(b) !== JSON.stringify(binding))
        )
          throw Error("Ground static texture aliases differ");
        if (binding.kind === "prepared-texture") {
          const layer = { TEXTURE__TX: "base", TEXTUREMULT__TX: "mult" }[
            texture.name
          ];
          const sampler = n.samplers.find((s) => s.layer === layer);
          if (!sampler || sampler.descriptorHex !== binding.nativeSamplerHex)
            throw Error(
              "Ground static texture sampler differs from original pass5",
            );
        } else if (
          !["supplied-white-lookup", "supplied-transparent-remap"].includes(
            binding.kind,
          )
        )
          throw Error("Unverified ground texture resource");
      }
      for (const sampler of texture.samplers) {
        if (!sampler.sampler || Object.hasOwn(textures, sampler.glslName))
          throw Error("Ground sampler is ambiguous");
        textures[sampler.glslName] = binding;
      }
    }
  }
  const factors = [...Buffer.from(n.renderState.bytesHex, "hex")].slice(10, 14);
  if (factors.length !== 4 || factors.some((v) => ![1, 6, 7].includes(v)))
    throw Error("Unimplemented native ground blend factors");
  return {
    effectId: n.effectId,
    emitterIndex: n.emitterIndex,
    graphSha256: n.sha256,
    sourceDefinitionSha256: n.sourceDefinitionSha256,
    environment: n.environment,
    nativeDefines: n.renderState.defines,
    defines,
    family,
    shaders: { vertex: pair.vertex, pixel: pair.pixel },
    blocks,
    textures,
    nativeRenderStateHex: n.renderState.bytesHex,
    nativeBlendFactors: factors,
    suppliedDepthTest: !(emitter.miscRenderFlags & 1),
    suppliedDoubleSide: !!emitter.disableBackfaceCull,
    suppliedSortPass: emitter.pass ?? 0,
    materialPolicy: policy.policy,
    scenePolicy: policy,
  };
}
