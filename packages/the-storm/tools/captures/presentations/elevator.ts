import type { Presentation } from "@shepherdjerred/mc-harness/protocol/media.ts";

export default [
  {
    schema: 1,
    name: "elevator-layout",
    alt: "Two vertically aligned lift signs with a safe platform at each stop",
    caption:
      "Align the signs vertically and leave room to stand at each floor.",
    annotations: [],
  },
  {
    schema: 1,
    name: "elevator-lower",
    alt: "The lower elevator sign in the wilderness",
    caption: "Right-click Lift Up to reach the aligned upper stop.",
    annotations: [
      {
        kind: "arrow",
        from: [0.7, 0.25],
        to: [0.5, 0.5],
        text: "Lower stop",
        startMs: 0,
        endMs: 12_000,
      },
    ],
  },
  {
    schema: 1,
    name: "elevator-travel",
    alt: "Using the elevator to travel up and return to ground level",
    caption: "The signs move the player between aligned stops.",
    annotations: [
      {
        kind: "arrow",
        from: [0.65, 0.28],
        to: [0.5, 0.5],
        text: "Upper stop",
        atStep: "up-end",
        startMs: 0,
        endMs: 1800,
      },
      {
        kind: "arrow",
        from: [0.65, 0.28],
        to: [0.5, 0.5],
        text: "Back at ground",
        atStep: "down-end",
        startMs: 0,
        endMs: 1800,
      },
    ],
  },
] satisfies Presentation[];
