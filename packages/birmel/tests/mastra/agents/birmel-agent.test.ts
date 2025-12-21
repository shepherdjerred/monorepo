import { describe, test, expect, mock } from "bun:test";
import "../../setup.js";

// Mock @mastra/core/agent
mock.module("@mastra/core/agent", () => ({
  Agent: class MockAgent {
    name: string;
    instructions: string;
    model: unknown;
    tools: unknown[];

    constructor(config: {
      name: string;
      instructions: string;
      model: unknown;
      tools: unknown[];
    }) {
      this.name = config.name;
      this.instructions = config.instructions;
      this.model = config.model;
      this.tools = config.tools;
    }
  },
}));

// Mock @ai-sdk/anthropic
mock.module("@ai-sdk/anthropic", () => ({
  anthropic: (model: string) => ({ provider: "anthropic", model }),
}));

describe("birmel-agent", () => {
  describe("createBirmelAgent", () => {
    test("creates agent with correct name", async () => {
      const { createBirmelAgent } = await import(
        "../../../src/mastra/agents/birmel-agent.js"
      );

      const agent = createBirmelAgent();

      expect(agent.name).toBe("Birmel");
    });

    test("creates agent with system prompt", async () => {
      const { createBirmelAgent } = await import(
        "../../../src/mastra/agents/birmel-agent.js"
      );

      const agent = createBirmelAgent();

      expect(agent.instructions).toBeDefined();
      expect(typeof agent.instructions).toBe("string");
      expect(agent.instructions.length).toBeGreaterThan(0);
    });

    test("creates agent with Anthropic model", async () => {
      const { createBirmelAgent } = await import(
        "../../../src/mastra/agents/birmel-agent.js"
      );

      const agent = createBirmelAgent();

      expect(agent.model).toBeDefined();
    });

    test("creates agent with tools object", async () => {
      const { createBirmelAgent } = await import(
        "../../../src/mastra/agents/birmel-agent.js"
      );

      const agent = createBirmelAgent();

      expect(typeof agent.tools).toBe("object");
      expect(agent.tools).not.toBeNull();
    });

    test("agent has non-empty tools object", async () => {
      const { createBirmelAgent } = await import(
        "../../../src/mastra/agents/birmel-agent.js"
      );

      const agent = createBirmelAgent();

      expect(Object.keys(agent.tools).length).toBeGreaterThan(0);
    });
  });

  describe("SYSTEM_PROMPT", () => {
    test("contains personality description", async () => {
      const { SYSTEM_PROMPT } = await import(
        "../../../src/mastra/agents/system-prompt.js"
      );

      expect(SYSTEM_PROMPT).toContain("Birmel");
    });

    test("contains capabilities section", async () => {
      const { SYSTEM_PROMPT } = await import(
        "../../../src/mastra/agents/system-prompt.js"
      );

      expect(SYSTEM_PROMPT).toContain("Capabilities");
    });

    test("mentions Discord server management", async () => {
      const { SYSTEM_PROMPT } = await import(
        "../../../src/mastra/agents/system-prompt.js"
      );

      expect(SYSTEM_PROMPT.toLowerCase()).toContain("discord");
    });

    test("mentions music playback", async () => {
      const { SYSTEM_PROMPT } = await import(
        "../../../src/mastra/agents/system-prompt.js"
      );

      expect(SYSTEM_PROMPT.toLowerCase()).toContain("music");
    });

    test("mentions voice commands", async () => {
      const { SYSTEM_PROMPT } = await import(
        "../../../src/mastra/agents/system-prompt.js"
      );

      expect(SYSTEM_PROMPT.toLowerCase()).toContain("voice");
    });

    test("is a non-empty string", async () => {
      const { SYSTEM_PROMPT } = await import(
        "../../../src/mastra/agents/system-prompt.js"
      );

      expect(typeof SYSTEM_PROMPT).toBe("string");
      expect(SYSTEM_PROMPT.length).toBeGreaterThan(100);
    });
  });
});
