const r = await Bun.file(
  ".cache/replay-lineup-5667809143/research/browser-cdp-v37-initial-recording.json",
).json();
console.log(
  JSON.stringify(
    {
      contract: r.contract,
      first: r.frames[0],
      mid: r.frames.find(
        (x) =>
          x.playing && x.effectsEnabled && x.speed === 1 && x.replayTime >= 70,
      ),
      modes: [...new Set(r.frames.map((x) => x.mode))],
      display: [
        ...new Set(
          r.frames.map((x) =>
            JSON.stringify([x.width, x.height, x.pixelRatio]),
          ),
        ),
      ],
      prep: r.frames.filter((x) => x.effectPreparationActive).length,
    },
    null,
    2,
  ),
);
