import type { Presentation } from "@shepherdjerred/mc-harness/protocol/media.ts";

export default [
  {
    schema: 1,
    name: "bridge-retracted",
    alt: "The moving bridge is retracted, leaving a gap between its matching ends",
    caption: "Matching Bridge signs control the gap between the fixed ends.",
    annotations: [],
  },
  {
    schema: 1,
    name: "moving-bridge",
    alt: "A sign-controlled bridge opens and closes over a trench",
    caption: "Right-click either Bridge sign to toggle the moving section.",
    annotations: [
      {
        kind: "label",
        from: [0.15, 0.2],
        to: [0.15, 0.2],
        text: "Walkway extended",
        atStep: "open-end",
        startMs: 0,
        endMs: 1500,
      },
      {
        kind: "label",
        from: [0.15, 0.2],
        to: [0.15, 0.2],
        text: "Walkway retracted",
        atStep: "close-end",
        startMs: 0,
        endMs: 1500,
      },
    ],
  },
  {
    schema: 1,
    name: "bridge-extended",
    alt: "Bridge planks span the five spaces between its fixed ends",
    caption: "Activating either sign extends the walkway across the gap.",
    annotations: [],
  },
] satisfies Presentation[];
