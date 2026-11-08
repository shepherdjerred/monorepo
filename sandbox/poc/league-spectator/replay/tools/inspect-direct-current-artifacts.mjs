import { resolve, basename } from "node:path";
import { sha256 } from "../structural-comparison.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  root = resolve(import.meta.dir, ".."),
  reportNames = [
    "direct-effects",
    "direct-effect-kernels",
    "direct-birth-native-comparison",
    "direct-point-schedule-comparison",
    "direct-loaded-schedule-comparison",
    "direct-camera-schedule-comparison",
    "direct-angular-schedule-comparison",
    "direct-position-schedule-comparison",
    "direct-motion-schedule-comparison",
    "direct-blend-schedule-comparison",
    "direct-ground-schedule-comparison",
    "direct-trail-writer-comparison",
    "direct-trail-math-comparison",
    "direct-trail-asset-comparison",
    "direct-trail-schedule-comparison",
    "direct-worker-checkpoints",
    "direct-trail-worker-checkpoints",
    "direct-presentation-worker-control",
    "direct-renderer-loading",
    "direct-trail-renderer-loading",
    "direct-packet-placement-comparison",
    "direct-parent-flags-comparison",
    "world-resource-bindings-comparison",
    "resource-requests-comparison",
    "resource-reconstruction-worker-control",
    "unit-resource-mutations-comparison",
    "missile-targets-comparison",
    "missile-tracking-comparison",
    "target-visibility-comparison",
    "target-visibility-masks-comparison",
    "target-visibility-policy-comparison",
    "direct-ground-gpu-observation",
    "direct-ground-fow-rendering",
    "trail-birth-state-evidence",
    "direct-load-world-control",
    "direct-inventory-trails-v16-load-control",
  ],
  visualNames = [
    "effect",
    "loaded",
    "camera",
    "angular",
    "motion",
    "blend",
    "ground",
    "trail",
  ];
const hashes = new Map(),
  reports = [],
  failures = [];
async function digest(path) {
  path = resolve(path);
  if (!hashes.has(path))
    hashes.set(path, await sha256(await Bun.file(path).bytes()));
  return hashes.get(path);
}
async function check(path, expected, report) {
  const actual = await digest(path);
  if (actual !== expected)
    failures.push({ report, path: resolve(path), expected, actual });
}
let fingerprints = 0;
async function audit(path) {
  const data = await Bun.file(path).bytes(),
    report = JSON.parse(new TextDecoder().decode(data)),
    name = basename(path);
  reports.push({ path: resolve(path), sha256: await sha256(data) });
  if (Array.isArray(report.mismatches) && report.mismatches.length)
    throw Error(`Failing numerical proof: ${name}`);
  const values = report.inputs;
  if (!values || typeof values !== "object")
    throw Error(`Report has no input fingerprint map: ${name}`);
  for (const [key, value] of Object.entries(values)) {
    if (key === "producers")
      for (const [file, h] of Object.entries(value)) {
        await check(resolve(root, file), h, name);
        fingerprints++;
      }
    else if (key === "effectsManifestSha256") {
      await check(
        resolve(cache, "public/latest-effects/manifest.json"),
        value,
        name,
      );
      fingerprints++;
    } else if (typeof value === "string" && /^[0-9a-f]{64}$/.test(value)) {
      await check(key, value, name);
      fingerprints++;
    } else throw Error(`Unrecognized fingerprint contract ${name}:${key}`);
  }
  if (report.imageSha256)
    await check(path.replace(/\.json$/, ".png"), report.imageSha256, name);
  if (report.motionCapture)
    await check(report.motionCapture.path, report.motionCapture.sha256, name);
  return report;
}
await digest(import.meta.path);
for (const name of reportNames)
  await audit(resolve(cache, "research", `${name}.json`));
const visible = new Set(),
  samples = [];
for (const name of visualNames) {
  const report = await audit(
    resolve(cache, "visuals", `direct-${name}-components.json`),
  );
  for (const s of report.samples ?? []) {
    samples.push(s);
    if (s.visiblePixels > 0) visible.add(`${s.effectId}:${s.emitterIndex}`);
  }
}
const measured = JSON.parse(
    await Bun.file(
      resolve(cache, "research/direct-inventory-trails-v16-load-control.json"),
    ).text(),
  ),
  admitted = new Set(measured.inventory.components.map((c) => c.shaderKey)),
  rendered = [...visible].filter((key) => admitted.has(key)).sort(),
  missing = [...admitted].filter((key) => !visible.has(key)).sort();
for (const path of hashes.keys())
  if ((await sha256(await Bun.file(path).bytes())) !== hashes.get(path))
    throw Error(`Input changed during artifact audit: ${path}`);
for (const row of reports)
  if ((await sha256(await Bun.file(row.path).bytes())) !== row.sha256)
    throw Error(`Report changed during artifact audit: ${row.path}`);
const output = {
  schema: 1,
  kind: "current-direct-v16-artifact-integrity-control",
  reports,
  inputFingerprintsChecked: fingerprints,
  uniqueFilesChecked: hashes.size,
  inputs: Object.fromEntries([
    ...hashes,
    ...reports.map((row) => [row.path, row.sha256]),
  ]),
  failures,
  visualIntersection: {
    compiledComponents: admitted.size,
    offscreenVisibleComponents: rendered.length,
    offscreenVisibleDefinitions: new Set(
      rendered.map((key) => key.slice(0, key.lastIndexOf(":"))),
    ).size,
    assetGroups: [...new Set(rendered.map((key) => key.split("/")[1]))].sort(),
    missingComponents: missing,
    renderedKeys: rendered,
  },
  scope: {
    currentSourceAndArtifactHashes: failures.length === 0,
    offscreenPixelsOnly: true,
    actualMatchActivation: false,
    browserExecuted: false,
    historicalTimingReportsExcluded: true,
  },
};
await Bun.write(
  resolve(cache, "research/direct-v16-verification-audit.json"),
  JSON.stringify(output, null, 2),
);
console.log(
  JSON.stringify(
    {
      ...output,
      reports: reports.length,
      inputs: undefined,
      visualIntersection: {
        ...output.visualIntersection,
        renderedKeys: undefined,
      },
    },
    null,
    2,
  ),
);
if (failures.length) process.exitCode = 1;
