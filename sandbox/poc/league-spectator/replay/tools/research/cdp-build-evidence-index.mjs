const primary = ".cache/replay-spike/research/",
  secondary = ".cache/replay-lineup-5667809143/research/";
const artifacts = [
  primary + "browser-cdp-v37-final-primary-controls.json",
  primary + "browser-cdp-v37-final-primary-recording.json",
  primary + "browser-cdp-v37-final-primary-analysis.json",
  secondary + "browser-cdp-v37-final-controls.json",
  secondary + "browser-cdp-v37-final-recording.json",
  secondary + "browser-cdp-v37-final-analysis.json",
  primary + "browser-cdp-v37-final-primary-interaction-controls.json",
  primary + "browser-cdp-v37-gpu-diagnostics-primary-comparison.json",
  primary + "browser-cdp-v37-primary-long-task-attribution.json",
  primary + "browser-cdp-v37-frame-response-boundaries.json",
  primary + "direct-nav-camera-primary-delta-v37.json",
  primary + "shared-direct-playback-offscreen-v37-primary.json",
  secondary + "attached-bound-size-control-v37.json",
  secondary + "shared-direct-playback-offscreen-v37.json",
];
const hash = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  rows = [];
for (const path of artifacts) {
  const b = await Bun.file(path).bytes();
  rows.push({ path, bytes: b.length, sha256: hash(b) });
}
const pa = await Bun.file(
    primary + "browser-cdp-v37-final-primary-analysis.json",
  ).json(),
  sa = await Bun.file(secondary + "browser-cdp-v37-final-analysis.json").json();
const r = {
  schema: 1,
  kind: "actual-browser-and-offscreen-increment-evidence-index",
  build: "16.21.829.8620",
  protocol: "20e09df23c66b85e",
  browser: {
    product: "Chrome/156.0.8078.48",
    connection: "localhost CDP",
    isolatedProfile: true,
    headless: true,
    renderer: "ANGLE AMD Radeon(TM) Graphics Direct3D11",
    canvas: [1920, 1080],
    pixelRatio: 1,
  },
  normalPlayback: {
    bothReplays: {
      ordinaryPlay1x: true,
      ordinaryPlay4x: true,
      continuous69to99Window: true,
      clockDiscontinuities: 0,
      consoleNetworkGpuErrors: 0,
    },
    primaryCameraInteractions: [
      "follow Ornn",
      "follow Karthus",
      "pause",
      "orbit",
      "pan",
      "zoom",
      "backward/forward seeking",
    ],
    secondaryCameraInteractions: [
      "follow Sona",
      "follow Annie",
      "pause",
      "orbit",
      "pan",
      "zoom",
      "backward/forward seeking",
    ],
    primaryMeasurements: pa.measurements,
    secondaryMeasurements: sa.measurements,
  },
  offscreen: {
    primary: {
      prefixContributingInstances: 165,
      definitions: 27,
      components: 634,
      creatorChampions: ["Hecarim", "Jinx", "Maokai", "Vladimir"],
      componentDelta: 23,
      previousGeometryDrawsByteIdentical: 2664,
    },
    secondary: {
      prefixContributingInstances: 29,
      definitions: 6,
      components: 45,
      creatorChampions: [],
      boundSliceAddedInstances: 18,
      boundSliceAddedComponents: 34,
    },
    scope:
      "Supplied fixed offscreen projection and actual decoded worker draws; does not replace composite-browser per-instance pixel coverage or League reference footage.",
  },
  openGates: {
    display60Fps: false,
    firstFiveCreatorMilestone: false,
    primaryRepeatedSeekRasterParity: false,
    primaryRasterDifferencePixels: 42,
    primaryRendererLongTaskMs: 248,
    primaryRendererLongTaskReplayTime: 68.9029,
    exactStallCauseEstablished: false,
    leagueVisualParity: false,
  },
  sourceScope: [
    "Each browser run retains actual served JS response bytes and hashes in its controls.scripts entries; historical tests/runs are not relabeled as later source.",
    "Full performance runs precede capture-only diagnostic additions and shared explicit-bounds invalidation. Final capture diagnostics tested the latter source, outside timed playback.",
    "Driver UBO bytes, sampler bindings/parameters, nav output pixels, 14 effect packet records and 522 submission order match across diagnostic repeated seeks; remaining 42-pixel difference is unexplained.",
    "Secondary repeated canvas seek captures were byte-identical. Primary main-scene world-only pixels matched except the DOM FPS counter; effects composite did not.",
    "V38 rotation/basis native research is prospective only and no admission is activated by this index.",
  ],
  artifacts: rows,
};
await Bun.write(
  primary + "browser-cdp-v37-evidence-index.json",
  JSON.stringify(r, null, 2),
);
console.log(
  JSON.stringify({
    output: primary + "browser-cdp-v37-evidence-index.json",
    artifacts: rows.length,
    sha256: hash(
      await Bun.file(primary + "browser-cdp-v37-evidence-index.json").bytes(),
    ),
  }),
);
