import type { Presentation } from "@shepherdjerred/mc-harness/protocol/media.ts";

export default [
  {
    schema: 1,
    name: "sign-copied",
    alt: "Two signs now display the same welcome and storage-room text",
    caption:
      "Punch the source sign with a feather, then right-click the destination to paste its text.",
    annotations: [
      {
        kind: "label",
        from: [0.24, 0.29],
        to: [0.24, 0.29],
        text: "Source",
        startMs: 0,
        endMs: 12_000,
      },
      {
        kind: "label",
        from: [0.58, 0.29],
        to: [0.58, 0.29],
        text: "Pasted text",
        startMs: 0,
        endMs: 12_000,
      },
    ],
  },
] satisfies Presentation[];
