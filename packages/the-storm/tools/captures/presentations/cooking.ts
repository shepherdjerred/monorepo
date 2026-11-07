import type { Presentation } from "@shepherdjerred/mc-harness/protocol/media.ts";

export default [
  {
    schema: 1,
    name: "cooking-pot",
    alt: "A cooking-pot sign attached to stone with a magma block directly below the sign",
    caption: "Put the heat source one or two blocks directly below the sign.",
    annotations: [
      {
        kind: "arrow",
        from: [0.65, 0.25],
        to: [0.5, 0.5],
        text: "Cooking-pot sign",
        startMs: 0,
        endMs: 12_000,
      },
    ],
  },
  {
    schema: 1,
    name: "cooking-result",
    alt: "A cooked porkchop in the player inventory after using the cooking pot",
    caption: "The cooking pot turns the raw porkchop into cooked food.",
    annotations: [],
  },
] satisfies Presentation[];
