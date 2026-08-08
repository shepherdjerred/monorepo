import { ContextBundleSchema } from "@shepherdjerred/birmel/agent-runtime/contracts.ts";

export function createContextBundle() {
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
      id: "current",
      kind: "current-message",
      content: "CURRENT_MESSAGE_SENTINEL",
      characterCount: "CURRENT_MESSAGE_SENTINEL".length,
      rank: 1000,
      discordMessageId: "10000000000000001",
    },
  ];
  const assembled = sources.map(({ content }) => content).join("\n");
  return ContextBundleSchema.parse({
    version: 1,
    sources,
    assembled,
    sizes: {
      coreInstructions: "SYSTEM_POLICY_SENTINEL".length,
      persona: "PERSONA_SOURCE_SENTINEL".length,
      loreAndMemory: 0,
      transcript: "CURRENT_MESSAGE_SENTINEL".length,
      total: assembled.length,
    },
    selectedMemoryClaimIds: [],
    transcriptFetchFailed: false,
  });
}
