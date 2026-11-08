import type { Presentation } from "@shepherdjerred/mc-harness/protocol/media.ts";
export default [
  {
    schema: 1,
    name: "mail-reward-pending",
    alt: "The real mailbox lists a pending documentation reward delivery and its exclusive claim options.",
    caption:
      "A pending delivery lists its claim command; choose one option to collect it.",
    annotations: [],
  },
  {
    schema: 1,
    name: "mail-reward-collected",
    alt: "The mailbox has no pending reward deliveries after the selected eight iron ingots reach the player's hotbar.",
    caption:
      "The selected delivery is saved into your inventory; make room before claiming large deliveries.",
    annotations: [],
  },
] satisfies Presentation[];
