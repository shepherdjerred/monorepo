const r = await Bun.file(
  ".cache/replay-lineup-5667809143/research/shared-direct-playback-offscreen-v36.json",
).json();
console.log(Object.keys(r));
console.log(
  JSON.stringify(r.summary ?? r.coverage ?? r.results?.[0] ?? null).slice(
    0,
    3000,
  ),
);
const c = await Bun.file(
  ".cache/replay-lineup-5667809143/research/browser-cdp-v37-interaction-capture.json",
).json();
console.log(
  JSON.stringify(
    { coverage: c.drawSnapshot.coverage, renderer: c.diagnostics.renderer },
    null,
    2,
  ).slice(0, 4000),
);
