import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import {
  directRetirementFlags,
  directRemovalFlagTransition,
} from "../latest-direct-effect-retirement.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error(`Input changed: ${path}`);
  inputs[path] = hash;
  return bytes;
}
const json = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
const decoder = `${cache}/public/decoder-16.21-macos`;
const profile = await json(`${decoder}/profile.json`),
  image = await raw(`${decoder}/image.bin`);
if ((await sha256(image)) !== profile.decoderImageSha256)
  throw Error("Exact native image required");
let flags = 0,
  routing = 0,
  rejectedCorruptCohorts = 0;
function exactControlMatrix(report, name) {
  const parent = name === "vfx-retirement-native";
  if (
    report.kind !==
      (parent
        ? "native-system-retirement-observations"
        : "native-particle-entity-removal-observations") ||
    !Array.isArray(report.originalBlocks) ||
    !report.originalBlocks.length
  )
    throw Error(
      "Exact native lifecycle cohort kind and instruction blocks required",
    );
  const expected = new Set();
  if (parent) {
    for (const upper of [0, 0x4000, 0x8000, 0xff00])
      for (let low = 0; low < 256; low++)
        for (const mode of [false, true])
          expected.add(JSON.stringify([upper | low, mode]));
  } else {
    for (let reason = 0; reason < 256; reason++)
      for (const initial of [0, 0x4000, 0xffffffff, 0x10000000])
        for (const present of [false, true])
          expected.add(JSON.stringify([reason, initial, present]));
  }
  const rows = parent ? report.flags : report.routing;
  if (!Array.isArray(rows) || rows.length !== expected.size)
    throw Error("Complete unique original lifecycle control matrix required");
  for (const row of rows) {
    const key = parent
      ? [row.initial, row.mode]
      : [row.reasonByte, row.initialObjectFlags, row.effectPresent];
    if (!expected.delete(JSON.stringify(key)))
      throw Error("Duplicate or unexpected original lifecycle control");
  }
  if (expected.size) throw Error("Missing original lifecycle control");
  return rows;
}
for (const name of ["vfx-retirement-native", "effect-removal-native"]) {
  const report = await json(`${cache}/research/${name}.json`);
  const rows = exactControlMatrix(report, name),
    field = name === "vfx-retirement-native" ? "flags" : "routing";
  for (const changed of [
    { ...report, kind: "foreign-cohort" },
    { ...report, originalBlocks: [] },
    { ...report, [field]: rows.slice(1) },
    { ...report, [field]: [rows[0], rows[0], ...rows.slice(2)] },
  ]) {
    let rejected = false;
    try {
      exactControlMatrix(changed, name);
    } catch {
      rejected = true;
    }
    if (!rejected) throw Error("Corrupt lifecycle cohort was not rejected");
    rejectedCorruptCohorts++;
  }
  if (
    report.build !== "16.21.829.8620" ||
    report.protocol !== "20e09df23c66b85e"
  )
    throw Error("Exact native observation build required");
  for (const map of [report.inputs, report.sources])
    if (
      !map ||
      typeof map !== "object" ||
      Array.isArray(map) ||
      !Object.keys(map).length ||
      Object.values(map).some(
        (hash) => typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash),
      )
    )
      throw Error(
        "Nonempty original lifecycle input and producer fingerprints required",
      );
  for (const [path, expected] of Object.entries(report.inputs))
    if ((await sha256(await raw(path))) !== expected)
      throw Error(`Stale native observation input: ${path}`);
  for (const [name, expected] of Object.entries(report.sources))
    if ((await sha256(await raw(resolve(import.meta.dir, name)))) !== expected)
      throw Error(`Native source changed: ${name}`);
  for (const block of report.originalBlocks)
    if (
      !Number.isSafeInteger(block.rva) ||
      block.rva < 0 ||
      !Number.isSafeInteger(block.size) ||
      block.size <= 0 ||
      block.rva + block.size > image.length ||
      typeof block.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(block.sha256) ||
      (await sha256(image.subarray(block.rva, block.rva + block.size))) !==
        block.sha256
    )
      throw Error("Original lifecycle instructions changed");
  if (name === "vfx-retirement-native") {
    for (const row of rows) {
      const actual = directRetirementFlags(row.initial, row.mode);
      if (actual.flags !== row.after || Number(actual.enqueue) !== row.queued)
        throw Error("Original parent flag transition differs");
      flags++;
    }
  } else {
    for (const row of rows) {
      const actual = directRemovalFlagTransition({
        reasonByte: row.reasonByte,
        objectFlags: row.initialObjectFlags,
        parentFlags: 0,
        effectPresent: row.effectPresent,
      });
      if (
        actual.objectFlags !== row.objectFlags ||
        actual.parentFlags !== row.rootFlags ||
        Number(actual.enqueue) !== row.queued ||
        actual.entityEffectCleared !== row.effectPresent ||
        row.entityEffectPointer !== 0
      )
        throw Error("Original removal routing differs");
      routing++;
    }
  }
}
if (flags !== 2048 || routing !== 2048)
  throw Error("Complete original lifecycle control cohorts required");
for (const path of [
  import.meta.path,
  resolve(import.meta.dir, "../latest-direct-effect-retirement.mjs"),
  resolve(import.meta.dir, "../structural-comparison.mjs"),
])
  await raw(path);
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error(`Final input drift: ${path}`);
const output = `${cache}/research/direct-retirement-flags-comparison.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "direct-native-retirement-flag-comparison",
      flags,
      routing,
      rejectedCorruptCohorts,
      inputs,
      scope: {
        nativeParentFlagTransitions: true,
        resolvedWrapperRouting: true,
        exactUniqueOriginalControlMatrices: true,
        parentTickTranslated: false,
        particleTailsTranslated: false,
        nativeQueuesTranslated: false,
        directRuntimeIntegrated: false,
        browserAcceptance: false,
      },
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    output,
    flags,
    routing,
    rejectedCorruptCohorts,
    pass: true,
  }),
);
