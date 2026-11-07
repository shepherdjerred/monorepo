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
        kind: "arrow",
        from: [0.73, 0.34],
        to: [0.55, 0.47],
        text: "Hidden sign",
        startMs: 0,
        endMs: 12_000,
      },
      {
        kind: "arrow",
        from: [0.29, 0.36],
        to: [0.42, 0.57],
        text: "Lever",
        startMs: 0,
        endMs: 12_000,
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
        kind: "arrow",
        from: [0.65, 0.28],
        to: [0.64, 0.46],
        text: "Unlit",
        startMs: 0,
        endMs: 12_000,
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
        kind: "arrow",
        from: [0.65, 0.28],
        to: [0.64, 0.46],
        text: "Bulb on",
        startMs: 0,
        endMs: 12_000,
      },
      {
        kind: "arrow",
        from: [0.14, 0.36],
        to: [0.34, 0.51],
        text: "Candle on",
        startMs: 0,
        endMs: 12_000,
      },
    ],
  },
] satisfies Presentation[];
