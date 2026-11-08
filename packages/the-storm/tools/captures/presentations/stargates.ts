import type { Presentation } from "@shepherdjerred/mc-harness/protocol/media.ts";

export default [
  {
    schema: 1,
    name: "stargate-private-network",
    alt: "Creating a private Stargate network",
    caption: "Create a private network before naming it on your gate signs.",
    annotations: [
      {
        kind: "arrow",
        from: [0.7, 0.72],
        to: [0.23, 0.815],
        text: "Network created",
        startMs: 0,
        endMs: 12_000,
      },
    ],
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
        from: [0.72, 0.35],
        to: [0.49, 0.48],
        text: "Two-wide opening",
        startMs: 0,
        endMs: 12_000,
      },
      {
        kind: "arrow",
        from: [0.18, 0.32],
        to: [0.37, 0.45],
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
    annotations: [
      {
        kind: "arrow",
        from: [0.73, 0.28],
        to: [0.5, 0.42],
        text: "Gate name",
        startMs: 0,
        endMs: 12_000,
      },
      {
        kind: "arrow",
        from: [0.75, 0.61],
        to: [0.5, 0.53],
        text: "Network",
        startMs: 0,
        endMs: 12_000,
      },
    ],
  },
  {
    schema: 1,
    name: "player-stargate",
    alt: "A player-built Stargate with a selected destination",
    caption:
      "Select a destination on the sign, then press the button to open the gate.",
    annotations: [
      {
        kind: "arrow",
        from: [0.73, 0.35],
        to: [0.47, 0.47],
        text: "Selected destination",
        startMs: 0,
        endMs: 12_000,
      },
    ],
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
