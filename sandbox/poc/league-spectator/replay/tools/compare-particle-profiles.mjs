// A component performance comparison must retain exactly the same work/output.
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
const [arg] = process.argv.slice(2);
if (!arg || process.argv.length !== 3)
  throw Error("Usage: compare-particle-profiles.mjs <cache>");
const cache = resolve(arg),
  root = resolve(import.meta.dir, ".."),
  inputs = {},
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => {
    const b = new Uint8Array(await Bun.file(p).arrayBuffer());
    inputs[p] = sha(b);
    return b;
  },
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  baseline = await read(`${cache}/research/particle-profile-baseline.json`),
  bulk = await read(`${cache}/research/particle-profile-bulk.json`),
  memoryProof = await read(`${cache}/research/unicorn-bulk-inspection.json`);
if (
  baseline.kind !== "particle-playback-cpu-profile" ||
  bulk.kind !== baseline.kind ||
  baseline.bulkMemory !== false ||
  bulk.bulkMemory !== true ||
  baseline.build !== bulk.build ||
  !isDeepStrictEqual(baseline.counts, bulk.counts) ||
  baseline.scope.browserRun ||
  bulk.scope.browserRun ||
  baseline.scope.gpuSubmission ||
  bulk.scope.gpuSubmission ||
  memoryProof.mismatches !== 0 ||
  memoryProof.counts.comparisons !== 17 ||
  memoryProof.counts.heapGrowthChecks !== 1
)
  throw Error(
    "Particle comparison lacks matching workload/scope or native memory proof",
  );
for (const record of [baseline, bulk]) {
  for (const [path, expected] of Object.entries(record.inputs))
    if (sha(await raw(path)) !== expected)
      throw Error(`Particle profile input changed: ${path}`);
  for (const [name, expected] of Object.entries(record.sources))
    if (sha(await raw(`${root}/${name}`)) !== expected)
      throw Error(`Particle profile source changed: ${name}`);
}
if (baseline.frames.length !== bulk.frames.length)
  throw Error("Particle profile omits frames");
let geometryChecks = 0;
for (let i = 0; i < baseline.frames.length; i++) {
  const a = baseline.frames[i],
    b = bulk.frames[i];
  for (const key of ["time", "phase", "samples", "particles", "draws"])
    if (!isDeepStrictEqual(a[key], b[key]))
      throw Error(`Particle profile changed ${key} at frame ${i}`);
  geometryChecks += a.draws.length;
}
const result = {
  schema: 1,
  kind: "particle-playback-bulk-comparison",
  inputs,
  comparatorSha256: sha(await raw(import.meta.path)),
  counts: { ...bulk.counts, geometryDigestChecks: geometryChecks },
  baseline: baseline.timings,
  bulk: bulk.timings,
  ratios: {
    median: baseline.timings.medianMs / bulk.timings.medianMs,
    total: baseline.timings.totalMs / bulk.timings.totalMs,
  },
  mismatches: 0,
  scope: {
    sameWasmBinary: true,
    originalNativeMemoryErrorsPreserved: true,
    geometryCountsAndFrameTimesUnchanged: true,
    cpuOnly: true,
    browserRun: false,
    gpuSubmission: false,
    browserPerformanceEstablished: false,
    realTimeEstablished: false,
  },
};
await Bun.write(
  `${cache}/research/particle-bulk-comparison.json`,
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify({
    counts: result.counts,
    ratios: result.ratios,
    baseline: result.baseline,
    bulk: result.bulk,
  }),
);
