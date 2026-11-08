const path =
    ".cache/replay-spike/research/browser-cdp-v38-primary-recording.json",
  bytes = await Bun.file(path).bytes(),
  r = JSON.parse(new TextDecoder().decode(bytes));
const qs = (values) => {
  values.sort((a, b) => a - b);
  return {
    samples: values.length,
    p50: values[Math.ceil(values.length * 0.5) - 1] ?? null,
    p95: values[Math.ceil(values.length * 0.95) - 1] ?? null,
    max: values.at(-1) ?? null,
  };
};
const samples = new Map(r.gpuTimings.samples.map((s) => [s.wallTime, s])),
  groups = new Map();
for (const f of r.frames) {
  const s = samples.get(f.wallTime);
  if (!s || !f.playing || f.replayTime < 69 || f.replayTime > 99) continue;
  if (
    s.replayTime !== f.replayTime ||
    s.replayHash !== f.replayHash ||
    s.mode !== f.mode
  )
    throw Error("GPU owner mismatch");
  const cohort = f.effectsEnabled ? "effects" + f.speed + "x" : "worldOnly",
    key = cohort + ":" + Math.floor(f.replayTime),
    rows = groups.get(key) ?? [];
  rows.push({
    replayTime: f.replayTime,
    gpuMs: s.gpuMs,
    renderCalls: f.renderCalls,
    triangles: f.triangles,
    drawBufferBytes:
      f.directEffectFrame?.metrics.transport.drawBufferBytes ?? 0,
    worldMs: f.worldUpdateAndHudMs,
    navMs: f.directEffectFrame?.metrics.navPrepassCpuMs ?? 0,
  });
  groups.set(key, rows);
}
const bins = [...groups].map(([key, rows]) => ({
  key,
  ...Object.fromEntries(
    [
      "gpuMs",
      "renderCalls",
      "triangles",
      "drawBufferBytes",
      "worldMs",
      "navMs",
    ].map((k) => [k, qs(rows.map((r) => r[k]))]),
  ),
}));
const result = {
  kind: "browser-gpu-hotspot-localization",
  input: {
    path,
    sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  },
  scope:
    "Whole-scene GPU timers, not isolated effects or per-pass timings; replay-second bins are descriptive, not controlled same-state comparisons.",
  bins,
};
const output = ".cache/replay-spike/research/browser-cdp-v38-gpu-hotspots.json";
await Bun.write(output, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify(
    {
      output,
      slowest: bins
        .filter((b) => b.key.startsWith("effects1"))
        .sort((a, b) => b.gpuMs.p50 - a.gpuMs.p50)
        .slice(0, 8),
      baseline: bins
        .filter((b) => b.key.startsWith("world"))
        .sort((a, b) => b.gpuMs.p50 - a.gpuMs.p50)
        .slice(0, 2),
    },
    null,
    2,
  ),
);
