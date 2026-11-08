import type { Presentation } from "@shepherdjerred/mc-harness/protocol/media.ts";

export default [
  {
    schema: 1,
    name: "hidden-switch",
    alt: "An X sign on the hidden side of a block with an adjacent powered lever",
    caption:
      "Click the opposite face of the supporting block to toggle the lever beside the sign.",
    annotations: [
      {
        kind: "label",
        from: [0.51, 0.34],
        to: [0.51, 0.34],
        text: "Hidden sign",
        startMs: 0,
        endMs: 12000,
      },
      {
        kind: "box",
        from: [0.39, 0.53],
        to: [0.45, 0.62],
        text: "Lever",
        startMs: 0,
        endMs: 12000,
      },
    ],
  },
  {
    schema: 1,
    name: "lights-off",
    alt: "An unlit copper bulb and candle beside their light-switch sign",
    caption: "The supported lights start off.",
    annotations: [
      {
        kind: "label",
        from: [0.65, 0.28],
        to: [0.65, 0.28],
        text: "Unlit",
        startMs: 0,
        endMs: 12000,
      },
    ],
  },
  {
    schema: 1,
    name: "lights-on",
    alt: "The same copper bulb and candle lit together by the light-switch sign",
    caption: "One sign switches both nearby lights on together.",
    annotations: [
      {
        kind: "label",
        from: [0.65, 0.28],
        to: [0.65, 0.28],
        text: "Bulb on",
        startMs: 0,
        endMs: 12000,
      },
    ],
  },
] satisfies Presentation[];
