import type { Presentation } from "@shepherdjerred/mc-harness/protocol/media.ts";

export default [
  {
    schema: 1,
    name: "lock-private",
    alt: "A private lock names its owner and blocks untrusted players.",
    caption: "A private lock names its owner and blocks untrusted players.",
    annotations: [],
  },
  {
    schema: 1,
    name: "lock-public",
    alt: "A public lock allows anyone to use the container.",
    caption: "A public lock allows anyone to use the container.",
    annotations: [],
  },
  {
    schema: 1,
    name: "lock-donation",
    alt: "A donation lock lets visitors add items without taking them.",
    caption: "A donation lock lets visitors add items without taking them.",
    annotations: [],
  },
  {
    schema: 1,
    name: "lock-supply",
    alt: "A supply lock lets visitors take items without adding them.",
    caption: "A supply lock lets visitors take items without adding them.",
    annotations: [],
  },
  {
    schema: 1,
    name: "lock-display",
    alt: "A display lock lets visitors look without moving items.",
    caption: "A display lock lets visitors look without moving items.",
    annotations: [],
  },
  {
    schema: 1,
    name: "lock-trusted",
    alt: "Lock information lists TsmcDemoHelper with manage access",
    caption:
      "Manage access lets a trusted player open and break the locked container.",
    annotations: [],
  },
] satisfies Presentation[];
