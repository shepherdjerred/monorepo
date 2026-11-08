import type { Presentation } from "@shepherdjerred/mc-harness/protocol/media.ts";
export default [
  {
    schema: 1,
    name: "storm-shard-item",
    alt: "A genuine Storm Shard shows its name, glint, and lore.",
    caption: "Storm Shards power upgrades at the spawn windmill.",
    annotations: [],
  },
  {
    schema: 1,
    name: "storm-upgrade-before",
    alt: "The diamond sword has no Storm upgrade before the altar interaction.",
    caption:
      "Hold eligible gear and bring a shard to the windmill altar while it rains.",
    annotations: [],
  },
  {
    schema: 1,
    name: "shard-altar",
    alt: "The emerald altar inside the preserved spawn windmill.",
    caption:
      "Right-click the windmill's emerald block while holding your gear.",
    annotations: [],
  },
  {
    schema: 1,
    name: "storm-upgrade-after",
    alt: "The sword's actual lore now shows Storm I after consuming one shard.",
    caption:
      "The first upgrade consumes one shard and adds Storm I to the gear.",
    annotations: [],
  },
] satisfies Presentation[];
