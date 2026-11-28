import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve, toNamespacedPath } from "node:path";
import { gunzipSync } from "node:zlib";

const build = "16.23.841.8428";
const replaySha256 =
  "a7eff15aa08dd60e52a9c7e289aa99cfaf06fdd4edd789c1999ccef9fc5b7fa1";
const receiptSha256 =
  "e73de0b3d5911eb623552c9edb3ca6c7266f591ae6055c6c99caa17a09f29bb4";
const trackSha256 =
  "a33cab26aa67969d564319e47549a172c5d3679aa864de6d2adb0a0e69b99dda";
const sourceSha256 =
  "db7a34c924523a172b15985b0df241272a42351d17004ba51ea051c516da74de";
const trackBytes = 50_579_529;
const resourceKey = 0x685154d2;
const historicalFightHandle = 1073820917;
const lifetime = 0.5500000715255737;
const lastLiveAge = Math.fround(0.55);
const maximumMapUnitError = 0.00048828125;
const indices = "000001000200000002000300";
const vertexStride = 28;
const vertexCount = 4;
const positionBytes = 12;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function readNativeSamples(system) {
  assert.equal(system.sourceSha256, sourceSha256);
  assert.equal(system.emitter, "GroundGlow1");
  assert.equal(system.resourceKey, resourceKey.toString(16));
  const { event, cases } = system;
  assert.equal(event.status, "detached-placement-confirmed");
  assert.equal(event.parent, 0);
  assert.equal(event.context, 0);
  assert.equal(event.resourceKey, resourceKey);
  assert.equal(event.descriptor.resourceKey, resourceKey);
  assert.equal(event.descriptor.flags, 0x20);
  assert.deepEqual(event.descriptor.scaleRate, [1.25, 1]);
  const [position, duplicate, unused] = event.descriptor.positions;
  assert.equal(position.length, 3);
  assert.ok(
    position.every(
      (coordinate) =>
        Number.isFinite(coordinate) && coordinate === Math.fround(coordinate),
    ),
  );
  assert.deepEqual(duplicate, position);
  assert.deepEqual(unused, [0, 0, 0]);
  assert.deepEqual(
    cases.map(({ cadence }) => cadence).sort((a, b) => a - b),
    [60, 60, 120, 120],
  );
  const native = cases.find(({ cadence }) => cadence === 120);
  assert.equal(native.geometry.length, 68);
  const frames = new Map(native.geometry);
  for (const comparison of cases) {
    assert.equal(comparison.worldScale, 1.25);
    assert.equal(comparison.lastLiveAge, lastLiveAge);
    assert.equal(comparison.firstEmptyFloat32Age, lifetime);
    for (const [age, geometry] of comparison.geometry) {
      assert.deepEqual(geometry, frames.get(age));
    }
  }
  let previous = -1;
  const samples = native.geometry.map(([age, [nativeIndices, vertices]]) => {
    assert.ok(Number.isFinite(age) && age > previous && age < lifetime);
    previous = age;
    assert.equal(nativeIndices, indices);
    assert.match(vertices, /^[a-f0-9]{224}$/u);
    return { age, vertices };
  });
  assert.equal(samples[0].age, 0);
  assert.equal(samples.at(-1).age, lastLiveAge);
  return { event, position, samples: samples.slice(1) };
}

function translateVertices(hex, position, direction) {
  const vertices = Buffer.from(hex, "hex");
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    for (let axis = 0; axis < position.length; axis++) {
      const offset = vertex * vertexStride + axis * 4;
      const coordinate = vertices.readFloatLE(offset);
      vertices.writeFloatLE(coordinate + direction * position[axis], offset);
    }
  }
  return vertices;
}

function verifyReconstruction(normalized, { event, position, samples }) {
  for (const [index, sample] of samples.entries()) {
    assert.equal(sample.age, normalized[index].age);
    const reconstructed = translateVertices(
      normalized[index].vertices,
      position,
      1,
    );
    const original = Buffer.from(sample.vertices, "hex");
    if (event.handle === historicalFightHandle) {
      assert.deepEqual(reconstructed, original);
    }
    for (let vertex = 0; vertex < vertexCount; vertex++) {
      const base = vertex * vertexStride;
      for (let axis = 0; axis < position.length; axis++) {
        const offset = base + axis * 4;
        assert.ok(
          Math.abs(
            reconstructed.readFloatLE(offset) - original.readFloatLE(offset),
          ) <= maximumMapUnitError,
        );
      }
      assert.deepEqual(
        reconstructed.subarray(base + positionBytes, base + vertexStride),
        original.subarray(base + positionBytes, base + vertexStride),
      );
    }
  }
}

/** Export one translation-relative world quad and its reviewed shared media. */
export async function readBuildScopedRiftGroundGlowAssets(
  receiptPath,
  trackPath,
) {
  const path = toNamespacedPath(resolve(trackPath));
  const directory = dirname(path);
  const [receiptBytes, manifest] = await Promise.all([
    readFile(receiptPath),
    readFile(path),
  ]);
  assert.equal(sha256(receiptBytes), receiptSha256);
  const envelope = JSON.parse(manifest);
  let bytes = manifest;
  if (envelope.kind === "gzip-recorded-native-terrain-particles") {
    assert.equal(envelope.schema, 1);
    assert.equal(envelope.sha256, trackSha256);
    assert.equal(envelope.bytes, trackBytes);
    bytes = gunzipSync(
      await readFile(join(directory, "recorded-particles.json.gz")),
      {
        maxOutputLength: trackBytes,
      },
    );
  }
  assert.equal(bytes.length, trackBytes);
  assert.equal(sha256(bytes), trackSha256);
  const receipt = JSON.parse(receiptBytes);
  const track = JSON.parse(bytes);
  assert.equal(receipt.build, build);
  assert.equal(track.build, build);
  assert.equal(receipt.replaySha256, replaySha256);
  assert.equal(track.replaySha256, replaySha256);
  const { texture, palette, paths, depthTest } = track.worldUnmaskedQuad;
  assert.equal(depthTest, false);
  assert.equal(receipt.systems.length, 40);
  const cohorts = receipt.systems.map(readNativeSamples);
  assert.deepEqual(
    paths,
    cohorts.map(({ event: { handle, stamp: start }, samples }) => ({
      handle,
      start,
      end: start + lifetime,
      samples: samples.map((sample) => ({ ...sample, indices })),
    })),
  );

  // Preserve the previously isolated 1715s contribution byte-for-byte and
  // bound the error of translating these float32 offsets at every other origin.
  const anchor = cohorts.find(
    ({ event }) => event.handle === historicalFightHandle,
  );
  assert.ok(anchor);
  const samples = anchor.samples.map(({ age, vertices }) => ({
    age,
    vertices: translateVertices(vertices, anchor.position, -1).toString("hex"),
  }));
  for (const cohort of cohorts) verifyReconstruction(samples, cohort);

  const { vertex, fragment, noAlphaTestFragment } = track.shaders;
  const shaders = { vertex, fragment, noAlphaTestFragment };
  const files = new Map(
    await Promise.all(
      [texture, palette, ...Object.values(shaders)].map(async (name) => {
        const match =
          /^recorded-particles\/([a-f0-9]{64})\.(?:png|glsl)$/u.exec(name);
        assert.ok(match);
        const asset = await readFile(join(directory, name));
        assert.equal(sha256(asset), match[1]);
        return [name, asset];
      }),
    ),
  );
  return {
    family: {
      id: "maokai-e-ground-glow",
      components: [
        {
          texture,
          palette,
          indices,
          samples,
          lifetime,
          blend: "src-alpha-one",
          alphaTest: false,
          depthTest,
          centerY: 0,
          placement: "world",
        },
      ],
    },
    files,
    shaders,
  };
}
