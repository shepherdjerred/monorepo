import {
  ContextBundleSchema,
  TurnInputSchema,
  type ContextBundle,
  type TurnInput,
} from "@shepherdjerred/birmel/agent-runtime/contracts.ts";

export function createTurnInput(): TurnInput {
  return TurnInputSchema.parse({
    discordMessageId: "100000000000000001",
    guildId: "100000000000000002",
    channelId: "100000000000000003",
    threadId: "100000000000000004",
    userId: "186665676134547461",
    username: "alice",
    content: "Please check the current state.",
    attachments: [],
    triggerKind: "mention",
    receivedAt: new Date("2026-08-08T12:00:00.000Z"),
  });
}

export function createContextBundle(): ContextBundle {
  const sources = [
    {
      id: "system",
      kind: "system-policy",
      content: "SYSTEM_POLICY_SENTINEL",
      characterCount: "SYSTEM_POLICY_SENTINEL".length,
      rank: 100,
    },
    {
      id: "persona",
      kind: "persona",
      content: "PERSONA_SOURCE_SENTINEL",
      characterCount: "PERSONA_SOURCE_SENTINEL".length,
      rank: 90,
    },
    {
      id: "memory",
      kind: "memory",
      content: "RELEVANT_MEMORY_SENTINEL",
      characterCount: "RELEVANT_MEMORY_SENTINEL".length,
      rank: 80,
      memoryClaimId: "memory-claim-1",
    },
    {
      id: "transcript",
      kind: "transcript",
      content: "RELEVANT_TRANSCRIPT_SENTINEL",
      characterCount: "RELEVANT_TRANSCRIPT_SENTINEL".length,
      rank: 70,
      discordMessageId: "100000000000000005",
    },
    {
      id: "current",
      kind: "current-message",
      content: "Please check the current state.",
      characterCount: "Please check the current state.".length,
      rank: 1000,
      discordMessageId: "100000000000000001",
    },
  ];
  const assembled = [
    "ASSEMBLED_PROMPT_SENTINEL",
    ...sources.map(({ content }) => content),
  ].join("\n");

  return ContextBundleSchema.parse({
    version: 1,
    sources,
    assembled,
    sizes: {
      coreInstructions: "SYSTEM_POLICY_SENTINEL".length,
      persona: "PERSONA_SOURCE_SENTINEL".length,
      loreAndMemory: "RELEVANT_MEMORY_SENTINEL".length,
      transcript:
        "RELEVANT_TRANSCRIPT_SENTINEL".length +
        "Please check the current state.".length,
      total: assembled.length,
    },
    selectedMemoryClaimIds: ["memory-claim-1"],
    transcriptFetchFailed: false,
  });
}
