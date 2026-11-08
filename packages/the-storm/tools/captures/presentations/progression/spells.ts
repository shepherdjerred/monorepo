import type { Presentation } from "@shepherdjerred/mc-harness/protocol/media.ts";
export default [
  {
    schema: 1,
    name: "spell-mark-info",
    alt: "The Mark spell information lists its tier, reagents, and cooldown.",
    caption:
      "Use /spells info mark to check the requirements before binding a focus.",
    annotations: [],
  },
  {
    schema: 1,
    name: "spell-focus-reagents",
    alt: "A genuinely bound Mark focus is ready with redstone and lapis lazuli.",
    caption:
      "A bound Mark focus and ordinary redstone and lapis lazuli are ready for a cast.",
    annotations: [],
  },
  {
    schema: 1,
    name: "spell-mark-cast",
    alt: "Mark records the current position and spends its required reagents.",
    caption:
      "Mark records this location and consumes 15 redstone and 15 lapis lazuli.",
    annotations: [],
  },
  {
    schema: 1,
    name: "spell-recall-arrival",
    alt: "Recall returns the player to the recorded Mark after spending the remaining redstone.",
    caption:
      "Recall returns to the recorded Mark and consumes the remaining 15 redstone.",
    annotations: [],
  },
] satisfies Presentation[];
