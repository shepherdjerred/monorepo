const r = await Bun.file(
  ".cache/replay-spike/research/tracking-fixed-speed-integration-v38.json",
).json();
console.log(Object.keys(r));
console.log(
  JSON.stringify(r.summary ?? r.counts ?? r.akshan ?? r.results ?? null).slice(
    0,
    3000,
  ),
);
const d = await Bun.file(
  ".cache/replay-spike/research/direct-effects-delta-v38-primary.json",
).json();
console.log(Object.keys(d));
console.log(
  JSON.stringify(d.added ?? d.delta ?? d.counts ?? null).slice(0, 3000),
);
