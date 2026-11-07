import type { Presentation } from "@shepherdjerred/mc-harness/protocol/media.ts";

export default [
  {
    schema: 1,
    name: "gate-closed",
    alt: "A closed three-wide oak fence gate between stone posts",
    caption: "Each fence column reaches the ground when the gate is closed.",
    annotations: [
      {
        kind: "arrow",
        from: [0.25, 0.4],
        to: [0.5, 0.53],
        text: "Fence columns",
        startMs: 0,
        endMs: 12_000,
      },
    ],
  },
  {
    schema: 1,
    name: "gate-open",
    alt: "The raised gate leaves an open passage while the top fence row stays in place",
    caption:
      "Opening the gate removes the lower fences and keeps the top of each column.",
    annotations: [
      {
        kind: "arrow",
        from: [0.26, 0.2],
        to: [0.5, 0.28],
        text: "Top row stays",
        startMs: 0,
        endMs: 12_000,
      },
      {
        kind: "arrow",
        from: [0.25, 0.48],
        to: [0.48, 0.53],
        text: "Open passage",
        startMs: 0,
        endMs: 12_000,
      },
    ],
  },
] satisfies Presentation[];
