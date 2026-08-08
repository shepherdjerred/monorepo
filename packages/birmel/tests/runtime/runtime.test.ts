import { describe, expect, mock, test } from "bun:test";
import { z } from "zod";
import type {
  SpecialistId,
  SpecialistTaskPacket,
} from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import type { RuntimeDependencies } from "@shepherdjerred/birmel/agent-runtime/runtime.ts";
import { createContextBundle, createTurnInput } from "./fixtures.ts";

const defaultResult = {
  text: "default executor result",
  finishReason: "stop",
  inputTokens: 1,
  outputTokens: 1,
  stepCount: 1,
  toolEvents: [],
};

void mock.module("@shepherdjerred/birmel/agent-runtime/specialists.ts", () => ({
  executeDirect: async () => defaultResult,
  executeSpecialist: async () => defaultResult,
  executeIsolatedAutomationAgent: async () => defaultResult,
}));

const { createSpecialistTaskPacket, executeRoutedTurn } =
  await import("@shepherdjerred/birmel/agent-runtime/runtime.ts");

const SpecialistRoutesSchema = z.array(
  z.enum([
    "messaging",
    "server",
    "moderation",
    "music",
    "automation",
    "editor",
  ]),
);

const specialistRoutes = SpecialistRoutesSchema.parse([
  "messaging",
  "server",
  "moderation",
  "music",
  "automation",
  "editor",
]);

function successfulResult(text: string) {
  return {
    text,
    finishReason: "stop",
    inputTokens: 10,
    outputTokens: 5,
    stepCount: 1,
    toolEvents: [],
  };
}

describe("createSpecialistTaskPacket", () => {
  test("carries only the bounded task packet", () => {
    const optionsWithInternalState = {
      turn: createTurnInput(),
      context: createContextBundle(),
      personaId: "virmel",
      persona: "COMPACT_PERSONA_SENTINEL",
      managerHistory: "MANAGER_HISTORY_SENTINEL",
      toolTrace: "TOOL_TRACE_SENTINEL",
    };

    const packet = createSpecialistTaskPacket(optionsWithInternalState);
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

describe("executeRoutedTurn", () => {
  test("calls only the direct executor for direct conversation", async () => {
    let directCalls = 0;
    let specialistCalls = 0;
    let receivedPacket: SpecialistTaskPacket | undefined;
    const dependencies: RuntimeDependencies = {
      direct: async (packet) => {
        directCalls += 1;
        receivedPacket = packet;
        return successfulResult("direct result");
      },
      specialist: async () => {
        specialistCalls += 1;
        return successfulResult("unexpected specialist result");
      },
    };

    const result = await executeRoutedTurn({
      turn: createTurnInput(),
      context: createContextBundle(),
      personaId: "virmel",
      persona: "Compact persona",
      route: {
        route: "direct",
        confidence: 1,
        rationale: "Ordinary conversation",
      },
      dependencies,
    });

    expect(result.text).toBe("direct result");
    expect(directCalls).toBe(1);
    expect(specialistCalls).toBe(0);
    expect(receivedPacket?.request).toBe("Please check the current state.");
  });

  test.each(specialistRoutes)(
    "calls exactly one %s specialist executor",
    async (expectedSpecialist) => {
      let directCalls = 0;
      const specialistCalls: SpecialistId[] = [];
      const dependencies: RuntimeDependencies = {
        direct: async () => {
          directCalls += 1;
          return successfulResult("unexpected direct result");
        },
        specialist: async (specialist) => {
          specialistCalls.push(specialist);
          return successfulResult(`${specialist} result`);
        },
      };

      const result = await executeRoutedTurn({
        turn: createTurnInput(),
        context: createContextBundle(),
        personaId: "virmel",
        persona: "Compact persona",
        route: {
          route: expectedSpecialist,
          confidence: 0.95,
          rationale: `Needs ${expectedSpecialist}`,
        },
        dependencies,
      });

      expect(result.text).toBe(`${expectedSpecialist} result`);
      expect(directCalls).toBe(0);
      expect(specialistCalls).toEqual([expectedSpecialist]);
    },
  );
});
