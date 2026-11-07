import { strict as assert } from "node:assert";
import { resolve } from "node:path";
import { DirectNavmeshProducer } from "../latest-direct-navmesh-producer.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error(`Nav producer drift:${path}`);
  inputs[path] = hash;
  return bytes;
}
const read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p)));
await captureDirectSourceInputs([import.meta.path], raw);
const profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`),
  coordinate = await read(
    `${cache}/research/navmesh-resource-coordinates.json`,
  );
assert.equal(await sha256(image), profile.decoderImageSha256);
assert.equal(coordinate.kind, "regions-resource-row-gles-conformance");
assert.equal(coordinate.controls.length, 8);
for (const [path, hash] of Object.entries(coordinate.inputs))
  assert.equal(await sha256(await raw(path)), hash);
const cases = [];
let passesCompared = 0,
  uploadBytesCompared = 0;
for (const resolution of ["low", "high"]) {
  const native = await read(
    `${cache}/research/navmesh-producer-v29/native-${resolution}.json`,
  );
  assert.equal(native.kind, "original-navmesh-producer-research-prefix");
  assert.equal(native.boundary, null);
  assert.equal(native.scope.originalProducerCompleted, true);
  for (const [path, hash] of Object.entries({
    ...native.inputs,
    ...native.sources,
  }))
    assert.equal(await sha256(await raw(path)), hash, path);
  assert(native.originalBlocks.length > 0 && native.sourceBlocks.length > 0);
  for (const b of [...native.originalBlocks, ...native.sourceBlocks]) {
    assert(
      Number.isInteger(b.rva) &&
        b.rva >= 0 &&
        b.size > 0 &&
        b.rva + b.size <= image.length,
    );
    assert.equal(await sha256(image.subarray(b.rva, b.rva + b.size)), b.sha256);
  }
  for (const rva of [0x7400c0, 0x7408f0, 0x7414a0, 0x181b220, 0x1807580])
    assert(
      native.originalBlocks.some((b) => b.rva <= rva && b.rva + b.size > rva),
    );
  const n = native.result,
    source = n.source,
    highResolution = resolution === "high",
    producer = new DirectNavmeshProducer({
      width: source.width,
      height: source.height,
      highResolution,
    }),
    resources = producer.resources(),
    rgba = Uint8Array.fromHex(source.rgbaHex),
    initial = new DataView(Uint8Array.fromHex(n.manager.bytesHex).buffer),
    nativeOwners = new Map([
      ["mask-a", Number(initial.getBigUint64(0x30, true))],
      ["mask-b", Number(initial.getBigUint64(0x38, true))],
    ]),
    // Manager fields retain resource owners; material/device calls use their
    // underlying GPU objects. Keep these identities separate. The original
    // constructor creates and zero-uploads the two masks in manager order.
    nativeResource = new Map([
      ["mask-a", n.r8Updates[0].pointer],
      ["mask-b", n.r8Updates[1].pointer],
    ]);
  assert.equal(await sha256(rgba), source.sha256);
  assert.equal(n.originalConfig.highResolution, highResolution ? 1 : 0);
  assert.equal(source.dirty, 1);
  assert.equal(n.updates.length, 3);
  assert.equal(n.renderPasses.length, 15);
  assert.equal(n.r8Updates.length, 3); // Two original zero textures and first dirty upload.
  for (const row of n.r8Updates.slice(0, 2))
    assert(Uint8Array.fromHex(row.pixelsHex).every((v) => v === 0));
  const updates = [];
  for (const [index, now] of [1, 1.25, 1.5].entries()) {
    const row = n.updates[index],
      dirty = index === 0;
    // These targets are original pool leases, not manager-owned persistent
    // resources. The pool can exchange their physical identities next frame.
    nativeResource.set(
      "output",
      n.renderPasses[row.firstPass].draws[0].targetTexture,
    );
    nativeResource.set(
      "scratch",
      n.renderPasses[row.firstPass + 1].draws[0].targetTexture,
    );
    assert.notEqual(
      nativeResource.get("output"),
      nativeResource.get("scratch"),
    );
    assert.deepEqual(row.clock.ticks, [now * 1e9, now * 1e9, now * 1e9]);
    assert.equal(row.r8UploadCount, dirty ? 1 : 0);
    const plan = producer.update({
      now,
      rgba,
      dirty,
      force: false,
      modeUpdatesEnabled: true,
    });
    if (plan.upload) {
      const upload = n.r8Updates[2];
      assert.equal(upload.pointer, nativeResource.get(plan.upload.target));
      assert.equal(plan.upload.bytes.toHex(), upload.pixelsHex);
      uploadBytesCompared += plan.upload.bytes.length;
    }
    const state = new DataView(Uint8Array.fromHex(row.managerAfterHex).buffer);
    assert.equal(state.getFloat32(0x10, true), plan.lastUpdate);
    assert.equal(
      Number(state.getBigUint64(0x30, true)),
      nativeOwners.get(plan.passes[0].textures.current),
    );
    assert.equal(
      Number(state.getBigUint64(0x38, true)),
      nativeOwners.get(plan.passes[0].textures.target),
    );
    const expectedPixels = [];
    for (const [at, pass] of plan.passes.entries()) {
      const render = n.renderPasses[row.firstPass + at];
      assert.equal(render.draws.length, 1);
      const draw = render.draws[0];
      assert.equal(draw.coordinatePolicy, coordinate.policy);
      assert.equal(draw.nativeGpuParityEstablished, false);
      assert.equal(draw.targetTexture, nativeResource.get(pass.target));
      assert.equal(draw.width, resources.width);
      assert.equal(draw.height, resources.height);
      assert.equal(draw.count, 3);
      assert.equal(draw.first, 0);
      assert.equal(draw.uniformBuffers.length, 1);
      assert.equal(
        draw.uniformBuffers[0].bytesHex,
        new Uint8Array(Float32Array.from(pass.parameters).buffer).toHex(),
      );
      const names =
        pass.shader === "fade"
          ? {
              current: "SAMPLER_NAV_GRID_CURRENT__TX",
              target: "SAMPLER_NAV_GRID_TARGET__TX",
            }
          : { source: "srcTex__TX" };
      assert.equal(draw.textures.length, Object.keys(names).length);
      for (const [role, name] of Object.entries(names)) {
        const rows = draw.textures.filter((t) => t.name === name);
        assert.equal(rows.length, 1, name);
        assert.equal(
          rows[0].nativeTexture,
          nativeResource.get(pass.textures[role]),
        );
        const filter = pass.samplers[role] === "clamp-nearest" ? 9728 : 9729;
        assert.deepEqual(rows[0].sampler.queriedParameters, {
          10242: 33071,
          10243: 33071,
          32882: 33071,
          10241: filter,
          10240: filter,
        });
      }
      assert.equal(draw.redHex.length, resources.width * resources.height * 2);
      expectedPixels.push({
        redSha256: await sha256(Uint8Array.fromHex(draw.redHex)),
        rgbaSha256: draw.rgbaSha256,
      });
      passesCompared++;
    }
    updates.push({
      ...plan,
      upload: plan.upload
        ? { target: plan.upload.target, bytesHex: plan.upload.bytes.toHex() }
        : null,
      expectedPixels,
    });
  }
  assert(
    n.renderPasses[14].draws[0].redHex.match(/[1-9a-f]/),
    "Nonzero filtered output required",
  );
  cases.push({
    resolution,
    width: source.width,
    height: source.height,
    resources: {
      ...resources,
      masks: resources.masks.map((m) => ({
        ...m,
        initialBytesHex: m.initialBytes.toHex(),
        initialBytes: undefined,
      })),
    },
    updates,
  });
}
for (const [path, hash] of Object.entries(inputs))
  assert.equal(await sha256(await Bun.file(path).bytes()), hash, path);
const output = `${cache}/research/navmesh-producer-comparison.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "shared-navmesh-producer-native-command-differential",
      inputs,
      counts: { cases: cases.length, passesCompared, uploadBytesCompared },
      cases,
      mismatches: [],
      scope: {
        nativeCpuCommandProducer: true,
        sharedJsNoGuestCalls: true,
        allPixelShaderUniformBytesExact: true,
        allSourceAndDestinationTextureIdentitiesExact: true,
        textureIdentityScope:
          "persistent-masks-and-within-update-pool-lease-dag",
        originalPoolAllocatorTranslated: false,
        gpuReplayPending: true,
        nativeMetalGpuParity: false,
        decodedMapVariantRecovered: false,
        dynamicSourceMutationRecovered: false,
        finalScenePublicationRecovered: false,
        runtimeAdmissionChanged: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    cases: cases.length,
    passesCompared,
    uploadBytesCompared,
  }),
);
