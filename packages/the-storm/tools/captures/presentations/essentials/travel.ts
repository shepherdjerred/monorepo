import type { Presentation } from "@shepherdjerred/mc-harness/protocol/media.ts";

export default [
  {
    schema: 1,
    name: "saved-homes",
    alt: "The saved-home list contains riverside, saved at the player's real position.",
    caption:
      "Use /sethome riverside to save a location and /homes to list saved names.",
    annotations: [],
  },
  {
    schema: 1,
    name: "incoming-teleport-request",
    alt: "MapleFox requests a visit and the recipient sees Accept and Deny actions.",
    caption:
      "A teleport request arrives with actions to accept or deny the visit.",
    annotations: [],
  },
] satisfies Presentation[];
