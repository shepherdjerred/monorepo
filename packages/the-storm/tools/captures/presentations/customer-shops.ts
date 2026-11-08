import type { Presentation } from "@shepherdjerred/mc-harness/protocol/media.ts";

export default [
  {
    schema: 1,
    name: "shop-buy-sign",
    alt: "B 50 lets a customer buy sixteen oak planks for fifty crystals.",
    caption: "B 50 lets a customer buy sixteen oak planks for fifty crystals.",
    annotations: [],
  },
  {
    schema: 1,
    name: "shop-sell-sign",
    alt: "S 40 lets a customer sell sixteen oak planks for forty crystals.",
    caption: "S 40 lets a customer sell sixteen oak planks for forty crystals.",
    annotations: [],
  },
  {
    schema: 1,
    name: "shop-both-sign",
    alt: "A combined sign offers both prices for the same quantity.",
    caption: "A combined sign offers both prices for the same quantity.",
    annotations: [],
  },
  {
    schema: 1,
    name: "shop-unset-sign",
    alt: "A question mark leaves the item unset until the owner selects it.",
    caption:
      "A question mark leaves the item unset until the owner selects it.",
    annotations: [],
  },
  {
    schema: 1,
    name: "shop-stock",
    alt: "A barrel holds sixty-four oak planks available for shop trades",
    caption: "The shop trades the matching items stored in its container.",
    annotations: [],
  },
  {
    schema: 1,
    name: "shop-customer-buy",
    alt: "A successful purchase transfers sixteen oak planks and charges fifty crystals",
    caption:
      "The customer receives sixteen planks and pays the shop owner fifty crystals.",
    annotations: [],
  },
  {
    schema: 1,
    name: "shop-customer-sell",
    alt: "Selling the sixteen oak planks back pays forty crystals",
    caption:
      "Selling back pays the sign's S price, which can differ from its B price.",
    annotations: [],
  },
] satisfies Presentation[];
