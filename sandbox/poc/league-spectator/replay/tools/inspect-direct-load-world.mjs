import { resolve } from "node:path";
import { strict as assert } from "node:assert";
import { directLoadWorldPlacement } from "./direct-effect-load-world.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
const bytes = async (path) => {
  const b = await Bun.file(path).bytes(),
    h = await sha256(b);
  if (inputs[path] && inputs[path] !== h)
    throw Error("Supplied world proof input changed");
  inputs[path] = h;
  return b;
};
await captureDirectSourceInputs([import.meta.path], bytes);
const native = JSON.parse(
  new TextDecoder().decode(
    await bytes(resolve(cache, "research/direct-trail-schedule-native.json")),
  ),
);
for (const [name, h] of Object.entries(native.sources))
  assert.equal(await sha256(await bytes(resolve(import.meta.dir, name))), h);
for (const [path, h] of Object.entries(native.inputs))
  assert.equal(await sha256(await bytes(path)), h);
let nativeFrames = 0,
  translatedQueries = 0;
for (const c of native.cases) {
  if (c.motion !== "bend") continue;
  for (const frame of c.frames) {
    const source = frame.input,
      expectedBasis = source.basis.filter((_, i) => i < 12 && i % 4 !== 3);
    const event = {
      time: 0,
      placement: { kind: "explicit-world", position: [0, 250, 0] },
    };
    const value = directLoadWorldPlacement(event, source.time);
    assert.equal(value.boundObjectSize, 0);
    assert.equal(
      value.boundObjectSizeStatus,
      "supplied-native-component-control-zero",
    );
    assert.deepEqual(
      value.position.map(Math.fround),
      source.current.map(Math.fround),
    );
    assert.deepEqual(value.basis, expectedBasis);
    nativeFrames++;
    for (const offset of [10, 20]) {
      const translated = directLoadWorldPlacement(
        {
          ...event,
          time: offset,
          placement: { kind: "explicit-world", position: [1000, 500, -250] },
        },
        source.time + offset,
      );
      assert.deepEqual(
        translated.position.map(Math.fround),
        source.current.map((n, lane) =>
          Math.fround(n + [1000, 250, -250][lane]),
        ),
      );
      assert.deepEqual(translated.basis, expectedBasis);
      assert.equal(translated.boundObjectSize, 0);
      translatedQueries++;
    }
  }
}
assert.equal(nativeFrames, 732);
assert.throws(
  () =>
    directLoadWorldPlacement(
      {
        time: 0,
        descriptor: {},
        placement: { kind: "explicit-world", position: [0, 0, 0] },
      },
      1,
    ),
  /explicit performance/,
);
assert.throws(
  () =>
    directLoadWorldPlacement(
      { time: 2, placement: { kind: "explicit-world", position: [0, 0, 0] } },
      1,
    ),
  /explicit performance/,
);
for (const [path, h] of Object.entries(inputs))
  assert.equal(await sha256(await Bun.file(path).bytes()), h);
const report = {
  schema: 1,
  kind: "supplied-moving-bending-load-world-control",
  inputs,
  nativeFrames,
  translatedQueries,
  rejectedNonfixtureInputs: 2,
  scope: {
    sameSuppliedPathAndBasisAsNativeTrailControls: true,
    boundObjectSize: "explicit supplied zero for synthetic load control",
    originalMatchWorldPlacement: false,
    productionWorldAdapterChanged: false,
    actualMatchCoverage: false,
  },
};
await Bun.write(
  resolve(cache, "research/direct-load-world-control.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify({ ...report, inputs: Object.keys(inputs).length }));
