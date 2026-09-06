import { describe, expect, test } from "vitest";
import { createTaskPacket } from "@shepherdjerred/birmel/agent-runtime/runtime.ts";
import { createContextBundle, createTurnInput } from "./fixtures.ts";

describe("createTaskPacket", () => {
  test("carries only the bounded task packet", () => {
    const optionsWithInternalState = {
      turn: createTurnInput(),
      context: createContextBundle(),
      personaId: "virmel",
      persona: "COMPACT_PERSONA_SENTINEL",
      managerHistory: "MANAGER_HISTORY_SENTINEL",
      toolTrace: "TOOL_TRACE_SENTINEL",
    };

    const packet = createTaskPacket(optionsWithInternalState);
    const serialized = JSON.stringify(packet);

    expect(packet.persona).toBe("COMPACT_PERSONA_SENTINEL");
    expect(packet.personaId).toBe("virmel");
    expect(packet.context).toContain("RELEVANT_MEMORY_SENTINEL");
    expect(packet.context).toContain("RELEVANT_TRANSCRIPT_SENTINEL");
    expect(packet.context).not.toContain("SYSTEM_POLICY_SENTINEL");
    expect(packet.context).not.toContain("PERSONA_SOURCE_SENTINEL");
    expect(serialized).not.toContain("ASSEMBLED_PROMPT_SENTINEL");
    expect(serialized).not.toContain("MANAGER_HISTORY_SENTINEL");
    expect(serialized).not.toContain("TOOL_TRACE_SENTINEL");
    expect(Object.keys(packet).sort()).toEqual([
      "attachments",
      "channelId",
      "context",
      "guildId",
      "persona",
      "personaId",
      "request",
      "threadId",
      "userId",
      "username",
    ]);
  });
});
