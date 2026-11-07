// Aggregate regenerated numerical reports without rewriting their results or
// treating old native admission hashes as current coverage. Each comparer owns
// its cohort/provenance checks; this adds current transitive source closure.
import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { DIRECT_EFFECT_PROGRAM_VERSION } from "../latest-direct-effect-runtime.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  root = resolve(import.meta.dir, ".."),
  inputs = {},
  sources = {};
const artifactArg = process.argv.find((arg) =>
    arg.startsWith("--artifact-version="),
  ),
  artifactVersion = artifactArg
    ? Number(artifactArg.slice("--artifact-version=".length))
    : DIRECT_EFFECT_PROGRAM_VERSION;
if (!Number.isSafeInteger(artifactVersion) || artifactVersion < 1)
  throw Error("Positive artifact version required");
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error(`Input drift: ${path}`);
  inputs[path] = hash;
  return bytes;
}
const read = async (path) =>
    JSON.parse(new TextDecoder().decode(await raw(path))),
  cohorts = [
    ["point", "point", ""],
    ["loaded", "point", "--loaded"],
    ["camera", "point", "--camera"],
    ["angular", "point", "--angular"],
    ["position", "position", ""],
    ["motion", "position", "--motion"],
    ["zero-position", "position", "--zero-position"],
    ["particle-orientation", "position", "--particle-orientation"],
    ["integrated-rotation", "position", "--integrated-rotation"],
    ["soft-particles", "position", "--soft-particles"],
    ["blend", "blend", ""],
    ["ground", "ground", ""],
    ["trail", "trail", "--schedule"],
    ["quad-uv", "quad-uv", ""],
  ],
  results = [],
  failures = [];
await captureDirectSourceInputs(
  [
    import.meta.path,
    ...cohorts.map(([, tool]) =>
      resolve(import.meta.dir, `compare-direct-${tool}-schedule.mjs`),
    ),
  ],
  async (path) => {
    const bytes = await raw(path);
    sources[resolve(path)] = await sha256(bytes);
    return bytes;
  },
);
for (const [name, tool, args] of cohorts) {
  const path = resolve(
      cache,
      `research/direct-${name}-schedule-comparison.json`,
    ),
    report = await read(path),
    drift = [];
  if (
    !report.inputs ||
    !Array.isArray(report.mismatches) ||
    report.mismatches.length
  )
    throw Error(`Passing comparison required: ${name}`);
  for (const [file, expected] of Object.entries(report.inputs)) {
    if (typeof expected !== "string" || !/^[a-f0-9]{64}$/.test(expected))
      throw Error(`Flat report fingerprint required: ${name}/${file}`);
    const actual = await sha256(await raw(file));
    if (actual !== expected)
      drift.push({ path: resolve(file), expected, actual });
  }
  const reportPaths = new Set(
    Object.keys(report.inputs).map((path) => resolve(path)),
  );
  for (const file of [
    "latest-direct-effect-runtime.mjs",
    "latest-direct-effect-lifecycle.mjs",
    "latest-network-effect-lifecycle.mjs",
  ])
    if (!reportPaths.has(resolve(root, file)))
      drift.push({
        path: resolve(root, file),
        reason: "missing-shared-lifecycle-source-pin",
      });
  const row = {
    name,
    reproductionCommand:
      `bun sandbox/poc/league-spectator/replay/tools/compare-direct-${tool}-schedule.mjs .cache/replay-spike ${args}`.trim(),
    path,
    sha256: inputs[path],
    status: drift.length ? "stale-inputs" : "pass",
    inputFingerprints: Object.keys(report.inputs).length,
    counts: report.counts ?? {
      frames: report.frames,
      vertices: report.vertices,
      colors: report.colors,
      halfWords: report.halfWords,
      indices: report.indices,
      rngStates: report.rngStates,
    },
    maxPositionError: report.maxPositionError,
    mismatches: report.mismatches.length,
    drift,
  };
  results.push(row);
  failures.push(...drift.map((d) => ({ report: name, ...d })));
}
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error(`Final input drift: ${path}`);
const result = {
  schema: 1,
  kind: "current-direct-schedule-regression-and-source-closure",
  programVersion: DIRECT_EFFECT_PROGRAM_VERSION,
  artifactVersion,
  cohorts: results.length,
  passing: results.filter((r) => r.status === "pass").length,
  frames: results.reduce((n, r) => n + r.counts.frames, 0),
  mismatches: results.reduce((n, r) => n + r.mismatches, 0),
  failures,
  results,
  transitiveSourcePins: sources,
  inputs,
  scope: {
    suppliedWorldClockMotionAndSeeds: true,
    originalObservationsRetained: true,
    newlyAdmittedComponentsRequireExactOriginalCohortEquality: true,
    nativeWorldAcceptance: null,
    browserAcceptance: false,
    performanceMeasurement: false,
    framesOverlapBetweenCohorts: true,
  },
};
const output = resolve(
  cache,
  `research/direct-schedule-regressions-v${artifactVersion}.json`,
);
await Bun.write(output, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    output,
    cohorts: result.cohorts,
    passing: result.passing,
    frames: result.frames,
    mismatches: result.mismatches,
    failures,
    inputs: Object.keys(inputs).length,
    transitiveSourcePins: Object.keys(sources).length,
  }),
);
if (failures.length) process.exitCode = 1;
