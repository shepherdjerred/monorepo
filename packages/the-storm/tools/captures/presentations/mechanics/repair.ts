import type { Presentation } from "@shepherdjerred/mc-harness/protocol/media.ts";

export default [
  {
    schema: 1,
    name: "repair-before",
    alt: "A damaged iron pickaxe and iron ingots are ready at an iron repair block.",
    caption:
      "Hold a damaged iron pickaxe in your main hand and iron ingots in your offhand.",
    annotations: [
      {
        kind: "arrow",
        from: [0.15, 0.35],
        to: [0.49, 0.45],
        text: "Two repair ingredients",
        startMs: 0,
        endMs: 12_000,
      },
      {
        kind: "arrow",
        from: [0.12, 0.65],
        to: [0.33, 0.8],
        text: "Damaged pickaxe",
        startMs: 0,
        endMs: 12_000,
      },
    ],
  },
  {
    schema: 1,
    name: "repair-after",
    alt: "The repaired pickaxe has less damage and one iron ingot has been consumed.",
    caption:
      "Right-clicking the iron block repairs durability and consumes one matching ingredient.",
    annotations: [
      {
        kind: "arrow",
        from: [0.15, 0.35],
        to: [0.49, 0.45],
        text: "One ingredient spent",
        startMs: 0,
        endMs: 12_000,
      },
      {
        kind: "arrow",
        from: [0.12, 0.65],
        to: [0.33, 0.8],
        text: "62 durability restored",
        startMs: 0,
        endMs: 12_000,
      },
    ],
  },
] satisfies Presentation[];
