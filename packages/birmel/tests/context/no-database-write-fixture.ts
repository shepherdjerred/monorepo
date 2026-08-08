import { assembleContextBundle } from "@shepherdjerred/birmel/context/context-bundle.ts";

const bundle = assembleContextBundle({
  systemPolicy: "system-policy",
  personaProjection: "persona-projection",
  currentMessage: {
    id: "9000",
    authorName: "user",
    isBot: false,
    content: "current message",
    createdAt: new Date("2026-08-08T12:00:00.000Z"),
  },
  transcript: [],
  transcriptFetchFailed: false,
  rankedFragments: [],
  sessionEvents: [],
});

process.stdout.write(
  [String(bundle.version), String(bundle.sources.length)].join(":"),
);
