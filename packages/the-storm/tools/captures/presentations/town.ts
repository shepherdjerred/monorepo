import type { Presentation } from "@shepherdjerred/mc-harness/protocol/media.ts";

export default [
  {
    schema: 1,
    name: "town-roles",
    alt: "Town information lists the owner, assistants, and members.",
    caption: "Town information lists the owner, assistants, and members.",
    annotations: [],
  },
  {
    schema: 1,
    name: "town-transfer-confirmation",
    alt: "Ownership handover requires a separate confirmation before the owner changes.",
    caption:
      "Ownership handover requires a separate confirmation before the owner changes.",
    annotations: [],
  },
] satisfies Presentation[];
