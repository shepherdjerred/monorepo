import type { Presentation } from "@shepherdjerred/mc-harness/protocol/media.ts";

export default [
  {
    schema: 1,
    name: "claim-info",
    alt: "Claim information identifies the camp owning the chunk and its protection flags.",
    caption:
      "Use /claim info while standing in a claimed chunk to check its owner and flags.",
    annotations: [],
  },
  {
    schema: 1,
    name: "camp-overview",
    alt: "Your camp reports its members, claimed chunks, and activity window.",
    caption:
      "Your camp reports its members, claimed chunks, and activity window.",
    annotations: [],
  },
  {
    schema: 1,
    name: "claim-personal",
    alt: "A personal chunk keeps building and container access with its holder.",
    caption:
      "A personal chunk keeps building and container access with its holder.",
    annotations: [],
  },
  {
    schema: 1,
    name: "claim-shared",
    alt: "Sharing the chunk restores access for the camp.",
    caption: "Sharing the chunk restores access for the camp.",
    annotations: [],
  },
] satisfies Presentation[];
