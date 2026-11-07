import type { Presentation } from "@shepherdjerred/mc-harness/protocol/media.ts";

export default [
  {
    schema: 1,
    name: "sorting-before",
    alt: "Seven scattered stacks in a barrel, including split cobblestone and oak planks",
    caption: "Before sorting: matching stacks are split across the barrel.",
    annotations: [
      {
        kind: "arrow",
        from: [0.21, 0.23],
        to: [0.39, 0.34],
        text: "Split stacks",
        startMs: 0,
        endMs: 12_000,
      },
      {
        kind: "arrow",
        from: [0.23, 0.58],
        to: [0.42, 0.44],
        text: "More of the same item",
        startMs: 0,
        endMs: 12_000,
      },
    ],
  },
  {
    schema: 1,
    name: "sorting-after",
    alt: "Five organized stacks in the same barrel, with cobblestone and oak planks combined",
    caption:
      "After sorting: duplicate stacks combine and items fill the first slots.",
    annotations: [
      {
        kind: "arrow",
        from: [0.23, 0.23],
        to: [0.46, 0.34],
        text: "Combined and organized",
        startMs: 0,
        endMs: 12_000,
      },
    ],
  },
] satisfies Presentation[];
