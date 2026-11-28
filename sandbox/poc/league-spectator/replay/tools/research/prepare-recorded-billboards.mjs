import assert from "node:assert/strict";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { evaluateRecordedBillboard } from "../../recorded-terrain-billboard.mjs";
import { readLocalRecordedParticles } from "../build-local-scout-terrain-package.mjs";

const identity = {
  build: "16.23.841.8428",
  replaySha256:
    "a7eff15aa08dd60e52a9c7e289aa99cfaf06fdd4edd789c1999ccef9fc5b7fa1",
};
const sourceDigest =
  "c3b8e706d0bd496e499405f0a8336219551cd0b6629045ee79e6e0d1a5038a60";
const f = Math.fround;

// Normalized authored curves used by the pinned track's native receipts.
// Heimer: resolver 0fb3cb06 -> f17239e0, emitter Flash_Anim and bubble.
const flashColor = [
  [0, [1, 1, 1, 1]],
  [f(0.1), [1, 1, 1, 1]],
  [1, [1, f(0.3), 0, 0]],
];
const heimer = (from, to) => ({
  birthScale: [100, 100],
  birthColor: [1, 1, 1, 1],
  scale: [
    [0, [from, from]],
    [1, [to, to]],
  ],
  color: flashColor,
});
// Kai'Sa: resolver a216a0e4 -> 14b4ac30, complex emitter index 6.
// The native insertion is 250x150 in authored axes. This quad writer's
// uniform-scale material path emits 250 on both local billboard axes.
const kaisaTint = [1, f(211 / 255), f(99 / 255)];
const programs = new Map([
  ["heimerdinger-w-impact", [heimer(0, 3), heimer(0.5, 2)]],
  [
    "kaisa-e-activation",
    [
      {
        birthScale: [250, 250],
        birthColor: [1, 1, 1, f(32768 / 65535)],
        scale: [[0, [1, 1]]],
        color: [
          [0, [...kaisaTint, 0]],
          [f(0.35), [...kaisaTint, 1]],
          [f(0.6), [...kaisaTint, 1]],
          [1, [...kaisaTint, 0]],
        ],
      },
    ],
  ],
]);

const [source, destination] = process.argv.slice(2);
assert.ok(
  process.argv.length === 4 && source && destination,
  "Usage: bun prepare-recorded-billboards.mjs <reviewed V67 track manifest> <fresh .cache output directory>",
);
const output = resolve(destination);
const parent = relative(
  await realpath(".cache"),
  await realpath(dirname(output)),
);
assert.ok(!isAbsolute(parent) && parent.split(/[\\/]/u, 1)[0] !== "..");
const files = await readLocalRecordedParticles(source, sourceDigest, identity);
const manifestPath = "recorded-particles.json";
const track = JSON.parse(files.get(manifestPath));
let checked = 0;
for (const [id, familyPrograms] of programs) {
  const family = track.families.find((entry) => entry.id === id);
  assert.equal(family?.components.length, familyPrograms.length, id);
  for (const [index, billboard] of familyPrograms.entries()) {
    const component = family.components[index];
    component.billboard = billboard;
    assert.equal(component.samples.length, 7, id);
    for (const { age, vertices } of component.samples) {
      const actual = Buffer.from(evaluateRecordedBillboard(component, age));
      assert.equal(
        actual.toString("hex"),
        vertices,
        `${id} component ${index} at ${age}s`,
      );
      checked++;
    }
  }
}
const manifest = JSON.stringify(track);
files.set(manifestPath, manifest);
await mkdir(output);
await mkdir(join(output, "recorded-particles"));
await Promise.all(
  [...files].map(([path, bytes]) =>
    writeFile(join(output, path), bytes, { flag: "wx" }),
  ),
);
const verifiedBytes = await readFile(join(output, manifestPath));
const sha256 = Bun.CryptoHasher.hash("sha256", verifiedBytes, "hex");
console.log(
  JSON.stringify({ manifest: join(output, manifestPath), sha256, checked }),
);
