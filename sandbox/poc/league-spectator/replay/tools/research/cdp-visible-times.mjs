const r = await Bun.file(
  ".cache/replay-lineup-5667809143/research/shared-direct-playback-offscreen-v36.json",
).json();
console.log(
  JSON.stringify(
    {
      counts: r.counts,
      first: r.frames.find((x) => x.changedPixels > 0) ?? r.frames[0],
    },
    null,
    2,
  ).slice(0, 3500),
);
