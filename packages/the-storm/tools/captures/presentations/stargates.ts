import type { Presentation } from "@shepherdjerred/mc-harness/protocol/media.ts";

export default [
  {
    schema: 1,
    name: "stargate-private-network",
    alt: "Creating a private Stargate network",
    caption: "Create a private network before naming it on your gate signs.",
    annotations: [],
  },
  {
    schema: 1,
    name: "stargate-frame",
    alt: "The two-wide, three-high opening of a player-built Stargate",
    caption:
      "Leave the two-wide, three-high opening empty, with the sign and button on opposite sides.",
    annotations: [
      {
        kind: "arrow",
        from: [0.68, 0.2],
        to: [0.49, 0.48],
        text: "2-wide opening",
        startMs: 0,
        endMs: 12_000,
      },
      {
        kind: "box",
        from: [0.35, 0.42],
        to: [0.39, 0.49],
        text: "Button",
        startMs: 0,
        endMs: 12_000,
      },
    ],
  },
  {
    schema: 1,
    name: "stargate-sign",
    alt: "A registered Home Stargate sign",
    caption:
      "Name the gate on line 1 and the network on line 3; wait for the creation confirmation.",
    annotations: [],
  },
  {
    schema: 1,
    name: "player-stargate",
    alt: "A player-built Stargate with a selected destination",
    caption:
      "Select a destination on the sign, then press the button to open the gate.",
    annotations: [],
  },
  {
    schema: 1,
    name: "player-stargate-travel",
    alt: "Opening and walking through a player-built Stargate",
    caption: "The private network connects Home and Mine.",
    annotations: [
      {
        kind: "label",
        from: [0.65, 0.14],
        to: [0.65, 0.14],
        text: "Open the gate",
        startMs: 0,
        endMs: 600,
      },
      {
        kind: "label",
        from: [0.65, 0.14],
        to: [0.65, 0.14],
        text: "Walk through",
        startMs: 600,
        endMs: 1200,
      },
      {
        kind: "label",
        from: [0.65, 0.14],
        to: [0.65, 0.14],
        text: "Arrival",
        startMs: 1200,
        endMs: 4000,
      },
    ],
  },
] satisfies Presentation[];
