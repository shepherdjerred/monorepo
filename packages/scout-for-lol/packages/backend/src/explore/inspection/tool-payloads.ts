import { z } from "zod";
import { prisma } from "#src/database/index.ts";

export type ToolPayloadCapture = (input: {
  toolCallId: string;
  toolName: string;
  direction: "input" | "output";
  value: z.infer<ReturnType<typeof z.json>>;
}) => Promise<void>;

export function createToolPayloadCapture(
  conversationId: string,
  runId: string,
): ToolPayloadCapture {
  return async ({ value, ...input }) => {
    await prisma.exploreToolPayload.create({
      data: {
        conversationId,
        runId,
        ...input,
        payload: JSON.stringify(value),
      },
    });
  };
}

// These tools expose public League facts or evidence already shareable in an answer.
// Other tools need an explicit projection before their private contracts can be shared.
const PUBLIC_TOOLS = new Set([
  "load_skill",
  "get_report_language",
  "validate_report_query",
  "format_report_query",
  "run_report_query",
  "lookup_ability",
  "lookup_champion",
  "lookup_item",
  "lookup_rune",
  "lookup_summoner_spell",
  "lookup_patch_notes",
  "compare_patch_changes",
  "resolve_player",
  "materialize_query_dataset",
  "materialize_raw_documents",
  "inspect_dataset_schema",
  "analyze_javascript",
  "select_dataset_values",
]);

export function sharedToolPayload(
  toolName: string,
  value: unknown,
): z.infer<ReturnType<typeof z.json>> | null {
  const json = z.json().parse(value);
  if (!PUBLIC_TOOLS.has(toolName)) {
    if (json === null || typeof json !== "object" || Array.isArray(json))
      return {
        redacted:
          "Private tool details are available only to the conversation owner.",
      };
    return {
      redacted:
        "Private tool details are available only to the conversation owner.",
      ...Object.fromEntries(
        Object.entries(json).filter(
          ([key, item]) =>
            ["kind", "ok"].includes(key) &&
            (typeof item === "string" || typeof item === "boolean"),
        ),
      ),
    };
  }
  if (json !== null && typeof json === "object" && !Array.isArray(json)) {
    const { servers: _servers, guildIds: _guildIds, ...safe } = json;
    return safe;
  }
  return json;
}
