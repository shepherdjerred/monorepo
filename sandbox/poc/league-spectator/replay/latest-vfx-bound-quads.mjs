import { NativeVfxSpawnKernel } from "./latest-vfx-spawn.mjs";
import { NativeQuadRuntime } from "./latest-vfx-legacy-quads.mjs";
import { emitterPreviewMath } from "./latest-vfx-emitter.mjs";
import { sha256 } from "./structural-comparison.mjs";

const decode = (bytes) => JSON.parse(new TextDecoder().decode(bytes)),
  hex = (bytes) =>
    Array.from(bytes, (n) => n.toString(16).padStart(2, "0")).join(""),
  geometry = {
    context: 0x10030000,
    view: 0x10031000,
    draw: 0x10032000,
    indices: 0x10040000,
    vertices: 0x10080000,
  },
  writers = { camera: 0x1733290, arbitrary: 0x1730410 },
  vtables = { camera: 0x23f23b0, arbitrary: 0x23f20c8 };

export async function createLatestVfxBoundQuads(
  uc,
  profile,
  image,
  spawnBytes,
  emitterBytes,
  postloadBytes,
  definitionBytes,
  graphBytes,
  math = emitterPreviewMath,
) {
  if (
    (await sha256(image)) !== profile.decoderImageSha256 ||
    (await sha256(spawnBytes)) !== profile.vfxSpawnSha256 ||
    (await sha256(emitterBytes)) !== profile.vfxEmitterSha256 ||
    (await sha256(postloadBytes)) !== profile.vfxPostloadSha256 ||
    (await sha256(definitionBytes)) !== profile.vfxBoundQuadsSha256
  )
    throw Error("Bound quad package integrity mismatch");
  const meta = decode(definitionBytes),
    postload = decode(postloadBytes),
    spawn = decode(spawnBytes),
    emitter = decode(emitterBytes),
    graph = decode(graphBytes),
    digest = await sha256(graphBytes),
    ref = meta.templates.find((t) => t.sha256 === digest);
  if (
    !ref ||
    meta.schema !== 1 ||
    graph.schema !== 1 ||
    meta.build !== "16.21.829.8620" ||
    meta.protocol !== "20e09df23c66b85e" ||
    profile.clientVersion !== meta.build ||
    profile.protocolDigest !== meta.protocol ||
    meta.decoderImageSha256 !== profile.decoderImageSha256 ||
    meta.sliceSha256 !==
      "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b" ||
    meta.runtimeSha256 !==
      "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716" ||
    meta.vfxSpawnSha256 !== profile.vfxSpawnSha256 ||
    meta.vfxEmitterSha256 !== profile.vfxEmitterSha256 ||
    meta.vfxPostloadSha256 !== profile.vfxPostloadSha256 ||
    meta.vfxAssetsSha256 !== profile.vfxAssetsSha256 ||
    postload.vfxAssetsSha256 !== meta.vfxAssetsSha256 ||
    postload.build !== meta.build ||
    postload.protocol !== meta.protocol ||
    postload.decoderImageSha256 !== meta.decoderImageSha256 ||
    emitter.vfxSpawnSha256 !== profile.vfxSpawnSha256 ||
    emitter.decoderImageSha256 !== profile.decoderImageSha256 ||
    spawn.vfxBirthSha256 !== profile.vfxBirthSha256 ||
    spawn.vfxValuesSha256 !== profile.vfxValuesSha256 ||
    spawn.decoderImageSha256 !== profile.decoderImageSha256 ||
    meta.frameRva !== 0x1757f10 ||
    JSON.stringify(meta.writerRvas) !== JSON.stringify(writers) ||
    JSON.stringify(meta.primitiveVtables) !== JSON.stringify(vtables) ||
    meta.maximumParticles !== 1024 ||
    meta.uvScratchAddress !== 0x1002f000 ||
    meta.cameraCacheRva !== 0x1746290 ||
    meta.cameraCacheAddress !== 0x100e0000 ||
    meta.cameraInputAddress !== 0x100e3000 ||
    meta.cameraCacheDataOffset !== 0x158 ||
    meta.cameraCacheDataBytes !== 0x21d8 ||
    meta.cameraAngles !== 360 ||
    meta.degreeTrigTable.rva !== 0x20e0090 ||
    meta.degreeTrigTable.bytes !== 14400 ||
    meta.uvPredicateBlock.join(",") !== "23993709,23993790" ||
    meta.texturePresenceMarker !== 0x20000000 ||
    meta.defaultMultRva !== 0x253d218 ||
    meta.defaultMultBytes !== 0xa9 ||
    JSON.stringify(meta.geometryAddresses) !== JSON.stringify(geometry) ||
    JSON.stringify(meta.initializedGlobals.slice(0, 2)) !==
      JSON.stringify(emitter.initializedGlobals) ||
    meta.initializedGlobals.length !== 3 ||
    meta.initializedGlobals[2].rva !== 0x253d218 ||
    meta.initializedGlobals[2].bytesHex.length !== 0x152 ||
    !meta.initializedGlobals[2].bytesHex.endsWith("01") ||
    graph.build !== meta.build ||
    graph.protocol !== meta.protocol ||
    graph.effectId !== ref.effectId ||
    graph.emitterIndex !== ref.emitterIndex ||
    graph.sourceDefinitionSha256 !== ref.sourceDefinitionSha256 ||
    graph.postloadGraphSha256 !== ref.postloadGraphSha256 ||
    graph.primitiveKind !== ref.primitiveKind ||
    JSON.stringify(graph.uvFlags) !== JSON.stringify(ref.uvFlags) ||
    JSON.stringify(graph.addresses) !== JSON.stringify(spawn.addresses) ||
    ![
      "sincosf",
      "sinf",
      "cosf",
      "sqrtf",
      "acosf",
      "atan2f",
      "fmodf",
      "powf",
      "expf",
      "modff",
    ].every((n) => typeof math?.[n] === "function")
  )
    throw Error("Unsupported bound quad runtime/graph");
  const data = image instanceof Uint8Array ? image : new Uint8Array(image);
  if (
    (await sha256(
      data.subarray(
        meta.degreeTrigTable.rva,
        meta.degreeTrigTable.rva + meta.degreeTrigTable.bytes,
      ),
    )) !== meta.degreeTrigTable.sha256
  )
    throw Error("Bound quad degree-trig table changed");
  for (const block of meta.sourceBlocks)
    if (
      (await sha256(data.subarray(block.startRva, block.endRva))) !==
      block.sha256
    )
      throw Error("Bound quad original code changed");
  for (const template of meta.templates) {
    const source =
      postload.emitters[`${template.effectId}:${template.emitterIndex}`];
    if (
      !source ||
      source.sha256 !== template.postloadGraphSha256 ||
      source.definitionSha256 !== template.sourceDefinitionSha256 ||
      !Object.hasOwn(vtables, template.primitiveKind) ||
      typeof template.uvFlags.base !== "boolean" ||
      typeof template.uvFlags.mult !== "boolean"
    )
      throw Error("Bound quad source or primitive/UV classification mismatch");
  }
  const kernel = new NativeVfxSpawnKernel(
    uc,
    profile,
    image,
    spawn,
    graph,
    math,
  );
  // The generic decoder reserves a separate packet stack at this address.
  // This component uses the owned 0x10010008 stack instead. Remove the unused
  // first page so the opaque texture-presence marker is unmapped on both hosts.
  kernel.engine.mem_unmap(meta.texturePresenceMarker, 0x1000);
  kernel.enableEmitterMath();
  return new BoundQuadRuntime(kernel, meta);
}

function vector(value) {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((n) => typeof n === "number" && Number.isFinite(Math.fround(n)))
  );
}
function validateCamera(camera) {
  const axes = [camera?.right, camera?.up, camera?.axis];
  if (
    !axes.every(vector) ||
    axes.some(
      (v) => Math.abs(v.reduce((a, n) => a + n * n, 0) - 1) > 0.00002,
    ) ||
    [
      [0, 1],
      [0, 2],
      [1, 2],
    ].some(
      ([a, b]) =>
        Math.abs(axes[a].reduce((n, v, i) => n + v * axes[b][i], 0)) > 0.00002,
    ) ||
    typeof camera.multTexturePresent !== "boolean"
  )
    throw Error(
      "Explicit unit orthogonal camera axes and mult-texture presence required",
    );
  return axes;
}

class BoundQuadRuntime extends NativeQuadRuntime {
  advance(input) {
    if (!this.ready || this.closed)
      throw Error("Bound quad advance requires initialized state");
    const camera = {
      right: input.cameraRight,
      up: input.cameraUp,
      axis: input.viewAxis,
      multTexturePresent: input.multTexturePresent,
    };
    validateCamera(camera);
    this.kernel.u64(
      this.kernel.a.link + 0x58,
      camera.multTexturePresent ? this.metadata.texturePresenceMarker : 0,
    );
    super.advance(input);
  }
  frame(input) {
    this.advance(input);
    return {
      state: this.readState(),
      geometry: this.renderGeometry(input.viewPosition, {
        right: input.cameraRight,
        up: input.cameraUp,
        axis: input.viewAxis,
        multTexturePresent: input.multTexturePresent,
      }),
    };
  }
  renderGeometry(viewPosition, camera) {
    if (!this.ready || this.closed || !vector(viewPosition))
      throw Error(
        "Bound quad rendering requires initialized state and a finite view position",
      );
    const [right, up, axis] = validateCamera(camera),
      k = this.kernel,
      a = k.a,
      m = this.metadata,
      g = geometry,
      pool = k.q(a.actor + 0xa0),
      count = k.readU32(pool + 0x10);
    if (count > m.maximumParticles) throw Error("Bound quad particle limit");
    // This unmapped opaque marker represents only the writer's presence test.
    // A dereference fails; no native texture resource object is fabricated.
    k.u64(
      a.link + 0x58,
      camera.multTexturePresent ? m.texturePresenceMarker : 0,
    );
    k.engine.mem_write(g.context, new Uint8Array(0x3000));
    for (const [offset, pointer] of [
      [0, g.indices],
      [8, g.vertices],
      [0x10, g.draw],
      [0x18, a.actor],
      [0x20, g.view],
    ])
      k.u64(g.context + offset, pointer);
    k.put(g.view, viewPosition);
    k.put(g.view + 0x24, axis);
    k.put(m.cameraInputAddress, up);
    k.put(m.cameraInputAddress + 0x10, right);
    k.callNative(m.cameraCacheRva, {
      RDI: m.cameraCacheAddress + m.cameraCacheDataOffset,
      RSI: m.cameraInputAddress,
      RDX: m.cameraInputAddress + 0x10,
    });
    k.u64(m.cameraCacheAddress, g.view);
    k.u64(a.manager + 0x338, m.cameraCacheAddress);
    k.put(a.manager + 0x340, [1], "u32");
    const primitive = k.q(a.definition + 0x60),
      vtable = k.q(primitive) - k.base,
      kind = Object.keys(vtables).find((name) => vtables[name] === vtable);
    if (!kind) throw Error("Loaded bound quad primitive changed");
    k.mathCalls = [];
    k.callNative(writers[kind], { RDI: primitive, RSI: g.context });
    const nv = k.q(g.context + 8) - g.vertices,
      ni = k.q(g.context) - g.indices;
    if (nv !== count * 112 || ni !== count * 12)
      throw Error("Bound quad geometry output limit");
    return {
      verticesHex: hex(k.read(g.vertices, nv)),
      indicesHex: hex(k.read(g.indices, ni)),
      drawHex: hex(k.read(g.draw, 16)),
      mathCalls: [...k.mathCalls],
    };
  }
}
