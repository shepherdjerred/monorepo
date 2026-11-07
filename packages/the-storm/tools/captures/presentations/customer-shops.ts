import type { Presentation } from "@shepherdjerred/mc-harness/protocol/media.ts";

export default [
  {
    schema: 1,
    name: "shop-buy-sign",
    alt: "B 50 lets a customer buy sixteen oak planks for fifty crystals.",
    caption: "B 50 lets a customer buy sixteen oak planks for fifty crystals.",
    annotations: [
      {
        kind: "arrow",
        from: [0.7, 0.3],
        to: [0.5, 0.51],
        text: "16 for 50",
        startMs: 0,
        endMs: 12_000,
      },
    ],
  },
  {
    schema: 1,
    name: "shop-sell-sign",
    alt: "S 40 lets a customer sell sixteen oak planks for forty crystals.",
    caption: "S 40 lets a customer sell sixteen oak planks for forty crystals.",
    annotations: [
      {
        kind: "arrow",
        from: [0.7, 0.3],
        to: [0.5, 0.51],
        text: "16 for 40",
        startMs: 0,
        endMs: 12_000,
      },
    ],
  },
  {
    schema: 1,
    name: "shop-both-sign",
    alt: "A combined sign offers both prices for the same quantity.",
    caption: "A combined sign offers both prices for the same quantity.",
    annotations: [
      {
        kind: "arrow",
        from: [0.19, 0.3],
        to: [0.48, 0.51],
        text: "Buy price",
        startMs: 0,
        endMs: 12_000,
      },
      {
        kind: "arrow",
        from: [0.7, 0.3],
        to: [0.53, 0.51],
        text: "Sell price",
        startMs: 0,
        endMs: 12_000,
      },
    ],
  },
  {
    schema: 1,
    name: "shop-unset-sign",
    alt: "A question mark leaves the item unset until the owner selects it.",
    caption:
      "A question mark leaves the item unset until the owner selects it.",
    annotations: [
      {
        kind: "arrow",
        from: [0.7, 0.3],
        to: [0.5, 0.54],
        text: "Choose item",
        startMs: 0,
        endMs: 12_000,
      },
    ],
  },
  {
    schema: 1,
    name: "shop-stock",
    alt: "A barrel holds sixty-four oak planks available for shop trades",
    caption: "The shop trades the matching items stored in its container.",
    annotations: [
      {
        kind: "arrow",
        from: [0.69, 0.27],
        to: [0.331, 0.26],
        text: "Matching stock",
        startMs: 0,
        endMs: 12_000,
      },
    ],
  },
  {
    schema: 1,
    name: "shop-customer-buy",
    alt: "A successful purchase transfers sixteen oak planks and charges fifty crystals",
    caption:
      "The customer receives sixteen planks and pays the shop owner fifty crystals.",
    annotations: [
      {
        kind: "arrow",
        from: [0.62, 0.65],
        to: [0.14, 0.778],
        text: "50 crystals paid",
        startMs: 0,
        endMs: 12_000,
      },
    ],
  },
  {
    schema: 1,
    name: "shop-customer-sell",
    alt: "Selling the sixteen oak planks back pays forty crystals",
    caption:
      "Selling back pays the sign's S price, which can differ from its B price.",
    annotations: [
      {
        kind: "arrow",
        from: [0.62, 0.65],
        to: [0.14, 0.778],
        text: "40 crystals back",
        startMs: 0,
        endMs: 12_000,
      },
    ],
  },
] satisfies Presentation[];
