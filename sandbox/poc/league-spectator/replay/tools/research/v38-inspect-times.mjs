const d = await Bun.file(
  ".cache/replay-spike/research/direct-effects-delta-v38-primary.json",
).json();
console.log(JSON.stringify(d.addedComponents, null, 2).slice(0, 4000));
const p = await Bun.file(
  ".cache/replay-spike/research/shared-direct-playback-offscreen-v38-primary.json",
).json();
console.log(
  JSON.stringify(
    p.frames
      .filter((f) =>
        f.draws?.some((x) => JSON.stringify(x).includes("d213225a")),
      )
      .slice(0, 2),
    null,
    2,
  ).slice(0, 4500),
);
