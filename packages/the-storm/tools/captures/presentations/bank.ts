import type { Presentation } from "@shepherdjerred/mc-harness/protocol/media.ts";

export default [
  {
    schema: 1,
    name: "deposit-bank",
    alt: "A deposit bank barrel beside a cobblestone shelf",
    caption: "Closing the bank sends matching items to its linked shelf.",
    annotations: [],
  },
  {
    schema: 1,
    name: "bank-shelf-types",
    alt: "A shelf sign accepts cobblestone and oak planks on separate lines",
    caption: "Name one accepted item on each nonempty line below [Shelf].",
    annotations: [],
  },
  {
    schema: 1,
    name: "bank-deposit",
    alt: "Cobblestone, oak planks, and spruce logs placed in the deposit bank",
    caption: "Put supplies in the bank, then close it to route matching items.",
    annotations: [],
  },
  {
    schema: 1,
    name: "bank-delivered",
    alt: "Sixteen cobblestone and twelve oak planks have arrived in the linked shelf barrel",
    caption: "The shelf receives both accepted item types.",
    annotations: [],
  },
  {
    schema: 1,
    name: "bank-unmatched",
    alt: "Four spruce logs remain in the deposit bank after the matching items moved",
    caption: "Items without a matching shelf stay in the bank.",
    annotations: [],
  },
] satisfies Presentation[];
