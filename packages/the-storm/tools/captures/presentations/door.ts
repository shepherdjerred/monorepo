import type { Presentation } from "@shepherdjerred/mc-harness/protocol/media.ts";

export default [
  {
    schema: 1,
    name: "door-closed",
    alt: "Oak planks fill the moving section between the Door Up and Door Down ends",
    caption: "Matching signs and base blocks define the closed door.",
    annotations: [
      {
        kind: "arrow",
        from: [0.65, 0.43],
        to: [0.5, 0.49],
        text: "Moving planks",
        startMs: 0,
        endMs: 12_000,
      },
    ],
  },
  {
    schema: 1,
    name: "door-open",
    alt: "The three moving oak planks are removed, leaving an open doorway between the fixed ends",
    caption: "Opening the door stores its moving blocks for the next closing.",
    annotations: [
      {
        kind: "arrow",
        from: [0.65, 0.43],
        to: [0.5, 0.49],
        text: "Opening",
        startMs: 0,
        endMs: 12_000,
      },
      {
        kind: "arrow",
        from: [0.24, 0.3],
        to: [0.5, 0.28],
        text: "Fixed ends",
        startMs: 0,
        endMs: 12_000,
      },
    ],
  },
] satisfies Presentation[];
