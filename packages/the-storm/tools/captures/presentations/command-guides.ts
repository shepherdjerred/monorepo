import type { Presentation } from "@shepherdjerred/mc-harness/protocol/media.ts";

export default [
  {
    schema: 1,
    name: "crystal-balance",
    alt: "The wallet command shows crystals and the separate Credits balance.",
    caption:
      "The wallet command shows crystals and the separate Credits balance.",
    annotations: [],
  },
  {
    schema: 1,
    name: "skill-mining",
    alt: "The Mining detail shows the player's level and experience progress.",
    caption:
      "Use /skills mining to see your Mining level and progress toward the next level.",
    annotations: [],
  },
  {
    schema: 1,
    name: "perks-overview",
    alt: "The perks overview shows your level and the next price for every track.",
    caption:
      "The perks overview shows your level and the next price for every track.",
    annotations: [],
  },
  {
    schema: 1,
    name: "perks-mechanic",
    alt: "The Mechanic detail lists the builds unlocked at each level.",
    caption: "The Mechanic detail lists the builds unlocked at each level.",
    annotations: [],
  },
  {
    schema: 1,
    name: "travel-prices",
    alt: "Use /tpinfo to check the configured price and cooldown for each kind of travel.",
    caption:
      "Use /tpinfo to check the configured price and cooldown for each kind of travel.",
    annotations: [],
  },
  {
    schema: 1,
    name: "chat-channels",
    alt: "The channel list shows which conversations are visible and where you are speaking.",
    caption:
      "The channel list shows which conversations are visible and where you are speaking.",
    annotations: [],
  },
  {
    schema: 1,
    name: "help-mail",
    alt: "Use /help followed by a command to see its syntax.",
    caption: "Use /help followed by a command to see its syntax.",
    annotations: [],
  },
  {
    schema: 1,
    name: "ticket-help",
    alt: "Start a report with /ticket and a description of the problem.",
    caption: "Start a report with /ticket and a description of the problem.",
    annotations: [],
  },
] satisfies Presentation[];
