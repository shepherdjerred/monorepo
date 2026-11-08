import type { Presentation } from "@shepherdjerred/mc-harness/protocol/media.ts";

export default [
  {
    schema: 1,
    name: "crush-before",
    alt: "A Crush piston faces a single oak plank before receiving redstone power.",
    caption:
      "A Crush piston faces a single oak plank before receiving redstone power.",
    annotations: [
      {
        kind: "arrow",
        from: [0.35, 0.29],
        to: [0.6, 0.5],
        text: "Block to crush",
        startMs: 0,
        endMs: 12_000,
      },
    ],
  },
  {
    schema: 1,
    name: "crush-after",
    alt: "Crush breaks the plank instead of pushing it ahead of the extended head.",
    caption:
      "Crush breaks the plank instead of pushing it ahead of the extended head.",
    annotations: [
      {
        kind: "arrow",
        from: [0.35, 0.29],
        to: [0.6, 0.5],
        text: "Block removed",
        startMs: 0,
        endMs: 12_000,
      },
    ],
  },
  {
    schema: 1,
    name: "super-push-before",
    alt: "Two oak planks sit directly in front of the SuperPush piston.",
    caption: "Two oak planks sit directly in front of the SuperPush piston.",
    annotations: [
      {
        kind: "arrow",
        from: [0.32, 0.3],
        to: [0.56, 0.49],
        text: "Two planks",
        startMs: 0,
        endMs: 12_000,
      },
    ],
  },
  {
    schema: 1,
    name: "super-push-after",
    alt: "After normal extension, SuperPush moves the two planks four blocks farther.",
    caption:
      "After normal extension, SuperPush moves the two planks four blocks farther.",
    annotations: [
      {
        kind: "arrow",
        from: [0.2, 0.29],
        to: [0.24, 0.49],
        text: "Moved load",
        startMs: 0,
        endMs: 12_000,
      },
      {
        kind: "arrow",
        from: [0.66, 0.27],
        to: [0.63, 0.49],
        text: "Extended head",
        startMs: 0,
        endMs: 12_000,
      },
    ],
  },
] satisfies Presentation[];
