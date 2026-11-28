import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { prepareReplayForSeek } from "../../../../../../packages/scout-for-lol/packages/replay/src/prepare.ts";
import { readIndexedTurretSnapshots } from "./native-terrain-turrets.mjs";

const openingDigest =
  "94d19a7c8ac014bab45552f533cb31adbacc9d2abe33c028e29078009d796f16";
const archiveDigest =
  "e5a1d326f29482a5979fc743b8446fdb91b1df843e5650e3807b424fa27962ca";
const replayDigest =
  "4bb0f94d3ceb19df374c0937a9e59dcc866a5b92e4727b81c6c7d5b3aca970b7";
const sha256 = (bytes) => Bun.CryptoHasher.hash("sha256", bytes, "hex");
const hiddenRanges = ["Stage3", "Branches", "Foliage"];
const selectors = new Map([
  [44, 444],
  [45, 445],
]);

async function readReceipt(path, expected) {
  const bytes = await Bun.file(path).bytes();
  assert.equal(sha256(bytes), expected, "Bloom turret proof digest differs");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

export async function readMayhemBloomTurretHealth(input, comparison) {
  const [census, native] = await Promise.all([
    readReceipt(
      input.census,
      "95fc08cd571080ec5fff27707dbcfe62a655d1c7aa95850c4009bc11c6d19f7c",
    ),
    readReceipt(
      input.native,
      "5e790f8c19c306d56c8780369528815b6e56e32637e3d689092605801c1a1f8d",
    ),
  ]);
  assert.equal(census.identity.replaySha256, replayDigest);
  assert.deepEqual(native.agreementByStream, { 1: 630, 2: 189 });
  return comparison.instances.map(({ context, destroyedAtSeconds }) => {
    const points = [];
    let current;
    let max;
    for (const row of census.groups) {
      if (row.participantId !== context || row.stream !== 1) continue;
      if (destroyedAtSeconds !== null && row.timeSeconds >= destroyedAtSeconds)
        continue;
      current = row.values.current ?? current;
      max = row.values.max ?? max;
      assert.ok(
        current > 0 && max >= current,
        "Invalid observed live turret health",
      );
      const last = points.at(-1);
      assert.ok(last === undefined || last[0] <= row.timeSeconds);
      if (last?.[0] === row.timeSeconds)
        points[points.length - 1] = [row.timeSeconds, current, max];
      else if (last?.[1] !== current || last?.[2] !== max)
        points.push([row.timeSeconds, current, max]);
    }
    assert.equal(points[0]?.[0], 0);
    return { context, points };
  });
}

export async function readMayhemBloomTurretCoreComparison(
  input,
  identity,
  routes,
  replayBytes,
) {
  assert.equal(identity.replaySha256, replayDigest);
  assert.equal(identity.mayhemMapSkin, "Bloom");
  const [opening, geometry] = await Promise.all([
    readReceipt(input.opening, openingDigest),
    readReceipt(input.geometry, archiveDigest),
  ]);
  assert.equal(opening.replaySha256, replayDigest);
  assert.equal(sha256(replayBytes), replayDigest);
  const prepared = prepareReplayForSeek(
    new Uint8Array(replayBytes).buffer,
    (input, target) =>
      zstdDecompressSync(input, { maxOutputLength: target.byteLength }),
    { allowCurrentBuild: true },
  );
  const contexts = opening.bindings.map(({ context }) => context);
  const losses = new Map(
    prepared.observations.turrets.map(({ context, timeSeconds }) => [
      context,
      timeSeconds,
    ]),
  );
  assert.equal(losses.size, 6);
  assert.ok([...losses.keys()].every((context) => contexts.includes(context)));
  const lifetimes = contexts.map((context) => ({
    context,
    destroyedAtSeconds: losses.get(context) ?? null,
  }));
  readIndexedTurretSnapshots(
    prepared.packetReader,
    contexts,
  ).corroborateSnapshots(lifetimes);
  const bindings = [];
  for (const { skin, modelSha256 } of geometry.models) {
    const url = `/structure-models/${modelSha256}.glb`;
    const bytes = await Bun.file(
      join(dirname(input.geometry), `turret-${skin}`, "authored-geometry.glb"),
    ).bytes();
    assert.equal(sha256(bytes), modelSha256);
    assert.ok(!routes.has(url));
    routes.set(url, [bytes]);
    bindings.push({
      participantId: selectors.get(skin),
      url,
      skinScale: 1,
      hiddenRanges,
    });
  }
  const instances = [];
  for (const { context, skin, transform } of opening.bindings) {
    const selector = selectors.get(Number(skin.split("Skin").at(-1)));
    if (!selector) continue;
    instances.push({
      context,
      participantId: selector,
      position: transform.slice(12, 15),
      basis: [0, 4, 8].flatMap((index) => transform.slice(index, index + 3)),
      destroyedAtSeconds: losses.get(context) ?? null,
    });
  }
  assert.equal(bindings.length, 2);
  assert.equal(instances.length, 8);
  return {
    kind: "recorded-authored-turret-cores",
    bindings,
    instances,
  };
}
