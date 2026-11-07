import type { Presentation } from "@shepherdjerred/mc-harness/protocol/media.ts";

export default [
  {
    schema: 1,
    name: "town-roles",
    alt: "Town information lists the owner, assistants, and members.",
    caption: "Town information lists the owner, assistants, and members.",
    annotations: [
      {
        kind: "arrow",
        from: [0.58, 0.63],
        to: [0.27, 0.75],
        text: "Owner + assistant",
        startMs: 0,
        endMs: 12_000,
      },
    ],
  },
  {
    schema: 1,
    name: "town-transfer-confirmation",
    alt: "Ownership handover requires a separate confirmation before the owner changes.",
    caption:
      "Ownership handover requires a separate confirmation before the owner changes.",
    annotations: [
      {
        kind: "arrow",
        from: [0.58, 0.63],
        to: [0.27, 0.78],
        text: "Confirm separately",
        startMs: 0,
        endMs: 12_000,
      },
    ],
  },
] satisfies Presentation[];
