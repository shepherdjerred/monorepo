import type { Presentation } from "@shepherdjerred/mc-harness/protocol/media.ts";
export default [
  {
    schema: 1,
    name: "welcome-gate-selection",
    alt: "The welcome gate's actual sign interaction selects Skylands.",
    caption:
      "Right-click the gate sign to select a world, then press its button.",
    annotations: [],
  },
  {
    schema: 1,
    name: "welcome-stargate",
    alt: "The preserved welcome plaza's circular gate is open to Skylands.",
    caption:
      "The open welcome gate connects to the world selected on its sign.",
    annotations: [],
  },
  {
    schema: 1,
    name: "welcome-gate",
    alt: "Select and open the welcome gate, then walk through it to the authentic Skylands map.",
    caption: "Walk into the open portal to visit the selected world.",
    annotations: [
      {
        kind: "label",
        from: [0.08, 0.12],
        to: [0.08, 0.12],
        text: "Press the gate button",
        atStep: "open-start",
        startMs: 0,
        endMs: 700,
      },
      {
        kind: "label",
        from: [0.08, 0.42],
        to: [0.08, 0.42],
        text: "Walk through to Skylands",
        atStep: "travel-start",
        startMs: 0,
        endMs: 2200,
      },
    ],
  },
  {
    schema: 1,
    name: "skylands",
    alt: "The camera arrives on the copied live Skylands terrain through the actual world gate.",
    caption:
      "Skylands is a separate survival world reached through the welcome gate or Travel menu.",
    annotations: [],
  },
  {
    schema: 1,
    name: "spawn-town",
    alt: "The path by the windmill overlooks the preserved wheat fields and Spawn Town.",
    caption:
      "Explore the original roads, fields, and buildings around Spawn Town.",
    annotations: [],
  },
  {
    schema: 1,
    name: "historic-market-shop",
    alt: "A preserved player-built market shop retains its original sign on the copied live map.",
    caption:
      "The old market preserves player-built shops from the server's history.",
    annotations: [],
  },
] satisfies Presentation[];
