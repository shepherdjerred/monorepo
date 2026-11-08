import type { Presentation } from "@shepherdjerred/mc-harness/protocol/media.ts";

export default [
  {
    schema: 1,
    name: "deposit-bank",
    alt: "A deposit bank barrel beside a cobblestone shelf",
    caption: "Closing the bank sends matching items to its linked shelf.",
    annotations: [
      {
        kind: "arrow",
        from: [0.62, 0.3],
        to: [0.65, 0.51],
        text: "Drop-off bank",
        startMs: 0,
        endMs: 12_000,
      },
      {
        kind: "arrow",
        from: [0.16, 0.29],
        to: [0.21, 0.52],
        text: "Matching shelf",
        startMs: 0,
        endMs: 12_000,
      },
    ],
  },
  {
    schema: 1,
    name: "bank-shelf-types",
    alt: "A shelf sign accepts cobblestone and oak planks on separate lines",
    caption: "Name one accepted item on each nonempty line below [Shelf].",
    annotations: [
      {
        kind: "arrow",
        from: [0.63, 0.29],
        to: [0.51, 0.45],
        text: "One item type per line",
        startMs: 0,
        endMs: 12_000,
      },
    ],
  },
  {
    schema: 1,
    name: "bank-deposit",
    alt: "Cobblestone, oak planks, and spruce logs placed in the deposit bank",
    caption: "Put supplies in the bank, then close it to route matching items.",
    annotations: [
      {
        kind: "arrow",
        from: [0.23, 0.23],
        to: [0.373, 0.26],
        text: "Deposit all three types",
        startMs: 0,
        endMs: 12_000,
      },
    ],
  },
  {
    schema: 1,
    name: "bank-delivered",
    alt: "Sixteen cobblestone and twelve oak planks have arrived in the linked shelf barrel",
    caption: "The shelf receives both accepted item types.",
    annotations: [
      {
        kind: "arrow",
        from: [0.23, 0.23],
        to: [0.373, 0.26],
        text: "Accepted items arrive here",
        startMs: 0,
        endMs: 12_000,
      },
    ],
  },
  {
    schema: 1,
    name: "bank-unmatched",
    alt: "Four spruce logs remain in the deposit bank after the matching items moved",
    caption: "Items without a matching shelf stay in the bank.",
    annotations: [
      {
        kind: "arrow",
        from: [0.23, 0.23],
        to: [0.415, 0.26],
        text: "Unmatched logs stay here",
        startMs: 0,
        endMs: 12_000,
      },
    ],
  },
] satisfies Presentation[];
