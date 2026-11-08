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
    annotations: [
      {
        kind: "arrow",
        from: [0.67, 0.63],
        to: [0.21, 0.75],
        text: "Your next price",
        startMs: 0,
        endMs: 12_000,
      },
    ],
  },
  {
    schema: 1,
    name: "perks-mechanic",
    alt: "The Mechanic detail lists the builds unlocked at each level.",
    caption: "The Mechanic detail lists the builds unlocked at each level.",
    annotations: [
      {
        kind: "arrow",
        from: [0.66, 0.42],
        to: [0.1, 0.365],
        text: "Mechanic II",
        startMs: 0,
        endMs: 12_000,
      },
    ],
  },
  {
    schema: 1,
    name: "travel-prices",
    alt: "Use /tpinfo to check the configured price and cooldown for each kind of travel.",
    caption:
      "Use /tpinfo to check the configured price and cooldown for each kind of travel.",
    annotations: [
      {
        kind: "arrow",
        from: [0.66, 0.63],
        to: [0.18, 0.75],
        text: "Price + cooldown",
        startMs: 0,
        endMs: 12_000,
      },
    ],
  },
  {
    schema: 1,
    name: "chat-channels",
    alt: "The channel list shows which conversations are visible and where you are speaking.",
    caption:
      "The channel list shows which conversations are visible and where you are speaking.",
    annotations: [
      {
        kind: "arrow",
        from: [0.65, 0.68],
        to: [0.25, 0.625],
        text: "Selected channel",
        startMs: 0,
        endMs: 12_000,
      },
    ],
  },
  {
    schema: 1,
    name: "help-mail",
    alt: "Use /help followed by a command to see its syntax.",
    caption: "Use /help followed by a command to see its syntax.",
    annotations: [
      {
        kind: "arrow",
        from: [0.65, 0.68],
        to: [0.2, 0.765],
        text: "Command syntax",
        startMs: 0,
        endMs: 12_000,
      },
    ],
  },
  {
    schema: 1,
    name: "ticket-help",
    alt: "Start a report with /ticket and a description of the problem.",
    caption: "Start a report with /ticket and a description of the problem.",
    annotations: [
      {
        kind: "arrow",
        from: [0.65, 0.68],
        to: [0.26, 0.778],
        text: "Describe the problem",
        startMs: 0,
        endMs: 12_000,
      },
    ],
  },
] satisfies Presentation[];
