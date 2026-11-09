import type { Presentation } from "@shepherdjerred/mc-harness/protocol/media.ts";

export default [
  {
    schema: 1,
    name: "painting-before",
    alt: "A two-by-two painting mounted on a stone wall",
    caption: "Right-click to select another picture of the same size.",
    annotations: [],
  },
  {
    schema: 1,
    name: "painting-after",
    alt: "A different two-by-two painting on the same wall",
    caption: "The picture changes while its dimensions stay the same.",
    annotations: [],
  },
] satisfies Presentation[];
