import type { Presentation } from "@shepherdjerred/mc-harness/protocol/media.ts";

export default [
  {
    schema: 1,
    name: "camp-overview",
    alt: "Your camp reports its members, claimed chunks, and activity window.",
    caption:
      "Your camp reports its members, claimed chunks, and activity window.",
    annotations: [
      {
        kind: "arrow",
        from: [0.58, 0.63],
        to: [0.35, 0.74],
        text: "Members + land",
        startMs: 0,
        endMs: 12_000,
      },
    ],
  },
  {
    schema: 1,
    name: "claim-personal",
    alt: "A personal chunk keeps building and container access with its holder.",
    caption:
      "A personal chunk keeps building and container access with its holder.",
    annotations: [
      {
        kind: "arrow",
        from: [0.58, 0.63],
        to: [0.27, 0.778],
        text: "Personal access",
        startMs: 0,
        endMs: 12_000,
      },
    ],
  },
  {
    schema: 1,
    name: "claim-shared",
    alt: "Sharing the chunk restores access for the camp.",
    caption: "Sharing the chunk restores access for the camp.",
    annotations: [
      {
        kind: "arrow",
        from: [0.58, 0.63],
        to: [0.32, 0.815],
        text: "Camp access",
        startMs: 0,
        endMs: 12_000,
      },
    ],
  },
] satisfies Presentation[];
