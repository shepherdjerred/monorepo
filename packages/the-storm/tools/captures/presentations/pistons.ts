import type { Presentation } from "@shepherdjerred/mc-harness/protocol/media.ts";

export default [
  {
    schema: 1,
    name: "crush-before",
    alt: "A Crush piston faces a single oak plank before receiving redstone power.",
    caption:
      "A Crush piston faces a single oak plank before receiving redstone power.",
    annotations: [],
  },
  {
    schema: 1,
    name: "crush-after",
    alt: "Crush breaks the plank instead of pushing it ahead of the extended head.",
    caption:
      "Crush breaks the plank instead of pushing it ahead of the extended head.",
    annotations: [],
  },
  {
    schema: 1,
    name: "super-push-before",
    alt: "Two oak planks sit directly in front of the SuperPush piston.",
    caption: "Two oak planks sit directly in front of the SuperPush piston.",
    annotations: [],
  },
  {
    schema: 1,
    name: "super-push-after",
    alt: "After normal extension, SuperPush moves the two planks four blocks farther.",
    caption:
      "After normal extension, SuperPush moves the two planks four blocks farther.",
    annotations: [
      {
        kind: "label",
        from: [0.2, 0.29],
        to: [0.2, 0.29],
        text: "Moved load",
        startMs: 0,
        endMs: 12_000,
      },
      {
        kind: "label",
        from: [0.66, 0.27],
        to: [0.66, 0.27],
        text: "Piston head",
        startMs: 0,
        endMs: 12_000,
      },
    ],
  },
] satisfies Presentation[];
