import type { Presentation } from "@shepherdjerred/mc-harness/protocol/media.ts";
export default [
  {
    schema: 1,
    name: "bounce-before",
    alt: "TsmcDemoHelper stands on an upward-facing piston with a genuine Bounce sign.",
    caption:
      "Place a Bounce sign beside the piston and stand in front of its head.",
    annotations: [],
  },
  {
    schema: 1,
    name: "bounce-launch-demo",
    alt: "A real redstone pulse activates the Bounce piston and launches the second player upward.",
    caption: "Powering the piston launches entities in front of its head.",
    annotations: [
      {
        kind: "label",
        from: [0.08, 0.12],
        to: [0.08, 0.12],
        text: "Redstone pulse → launch",
        atStep: "launch-start",
        startMs: 0,
        endMs: 1300,
      },
      {
        kind: "label",
        from: [0.08, 0.12],
        to: [0.08, 0.12],
        text: "The player rises, then falls",
        atStep: "launch-start",
        startMs: 1300,
        endMs: 3500,
      },
    ],
  },
] satisfies Presentation[];
