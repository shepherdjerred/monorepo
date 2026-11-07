import type { Presentation } from "@shepherdjerred/mc-harness/protocol/media.ts";

export default [
  {
    schema: 1,
    name: "painting-before",
    alt: "A two-by-two painting mounted on a stone wall",
    caption: "Right-click to select another picture of the same size.",
    annotations: [
      {
        kind: "arrow",
        from: [0.76, 0.25],
        to: [0.59, 0.45],
        text: "Right-click",
        startMs: 0,
        endMs: 12_000,
      },
    ],
  },
  {
    schema: 1,
    name: "painting-after",
    alt: "A different two-by-two painting on the same wall",
    caption: "The picture changes while its dimensions stay the same.",
    annotations: [
      {
        kind: "arrow",
        from: [0.75, 0.27],
        to: [0.62, 0.63],
        text: "Same size",
        startMs: 0,
        endMs: 12_000,
      },
    ],
  },
] satisfies Presentation[];
