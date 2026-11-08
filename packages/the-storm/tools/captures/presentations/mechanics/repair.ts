import type { Presentation } from "@shepherdjerred/mc-harness/protocol/media.ts";

export default [
  {
    schema: 1,
    name: "repair-before",
    alt: "A damaged iron pickaxe and iron ingots are ready at an iron repair block.",
    caption:
      "Hold a damaged iron pickaxe in your main hand and iron ingots in your offhand.",
    annotations: [],
  },
  {
    schema: 1,
    name: "repair-after",
    alt: "The repaired pickaxe has less damage and one iron ingot has been consumed.",
    caption:
      "Right-clicking the iron block repairs durability and consumes one matching ingredient.",
    annotations: [],
  },
] satisfies Presentation[];
