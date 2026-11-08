const base = ".cache/replay-lineup-5667809143/research/";
const paths = [
  "browser-cdp-v37-1080p-recording.json",
  "browser-cdp-v37-1080p-analysis.json",
  "browser-cdp-v37-1080p-controls.json",
  "browser-cdp-v37-interaction-recording.json",
  "browser-cdp-v37-interaction-controls.json",
  "browser-cdp-v37-interaction-capture.json",
  "browser-cdp-v37-interaction-canvas.png",
  "browser-cdp-v37-visual.json",
  "browser-cdp-v37-visual.gif",
];
const artifacts = {};
for (const p of paths) {
  const b = await Bun.file(base + p).bytes();
  artifacts[p] = {
    bytes: b.length,
    sha256: new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  };
}
const a = await Bun.file(base + paths[1]).json();
const r = {
  schema: 1,
  kind: "actual-cdp-browser-increment-check",
  browser: "Chrome/156.0.8078.48",
  url: "http://127.0.0.1:4181/latest.html",
  environment: {
    headless: true,
    isolatedProfile: true,
    canvas: [1920, 1080],
    pixelRatio: 1,
    renderer: "ANGLE AMD Radeon(TM) Graphics Direct3D11",
    visibility: "visible",
    focus: true,
  },
  contract: a.contract,
  checks: {
    ordinaryPlay1x: true,
    ordinaryPlay4x: true,
    continuousReplayClock: true,
    consoleNetworkAndGpuErrors: 0,
    pausedCameraOrbitPanZoom: true,
    followedChampions: ["Sona", "Annie"],
    backwardForwardSeeks: [70, 82, 74, 82],
    longTasksOver100ms: 0,
  },
  measurements: Object.fromEntries(
    Object.entries(a.measurements).map(([k, v]) => [
      k,
      {
        averageDisplayFps: v.averageDisplayFps,
        simulationAndGeometryP95Ms: v.simulationAndGeometryP95Ms,
        completeContinuousWindowObserved: v.completeContinuousWindowObserved,
        clockDiscontinuities: v.clockDiscontinuities.length,
      },
    ]),
  ),
  limitations: [
    "Loaded browser module graph predates in-progress V37 bound-size integration; not final-source regression evidence.",
    "Browser JS/vendor response bodies were not archived at navigation; recording pins replay and scene/effect manifests only.",
    "Headless isolated hardware Chrome differs from user normal browser profile.",
    "60 FPS target not met.",
    "Renderer submission is not per-instance visible pixel proof.",
    "Additional repeated seek canvas-hash diagnostic hit a stale capture rejection; normal playback/seeking did not throw.",
    "Full coverage and League image parity remain unestablished.",
  ],
  artifacts,
};
await Bun.write(
  base + "browser-cdp-v37-increment.json",
  JSON.stringify(r, null, 2),
);
console.log(
  JSON.stringify({
    output: base + "browser-cdp-v37-increment.json",
    artifacts: paths.length,
  }),
);
