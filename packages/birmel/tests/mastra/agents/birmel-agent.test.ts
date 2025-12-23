import { describe, test, expect, mock } from "bun:test";
import "../../setup.js";

// Mock @mastra/core/agent
mock.module("@mastra/core/agent", () => ({
  Agent: class MockAgent {
    name: string;
    private _instructions: string;

    constructor(config: { name: string; instructions: string; [key: string]: unknown }) {
      this.name = config.name;
      this._instructions = config.instructions;
    }

    getInstructions(): string {
      return this._instructions;
    }
  },
}));

// Mock @ai-sdk/openai
const mockOpenai = (model: string) => ({ provider: "openai", model });
mockOpenai.chat = (model: string) => ({ provider: "openai.chat", model });
mockOpenai.responses = (model: string) => ({ provider: "openai.responses", model });
mock.module("@ai-sdk/openai", () => ({
  openai: mockOpenai,
}));

// Mock @mastra/memory
mock.module("@mastra/memory", () => ({
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  Memory: class MockMemory {},
}));

// Mock @mastra/libsql to avoid MessageList dependency
mock.module("@mastra/libsql", () => ({
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  LibSQLStore: class MockLibSQLStore {},
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  LibSQLVector: class MockLibSQLVector {},
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

    test("creates agent without throwing", async () => {
      const { createBirmelAgent } = await import(
        "../../../src/mastra/agents/birmel-agent.js"
      );

      expect(() => createBirmelAgent()).not.toThrow();
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

    test("contains authorization section", async () => {
      const { SYSTEM_PROMPT } = await import(
        "../../../src/mastra/agents/system-prompt.js"
      );

      expect(SYSTEM_PROMPT.toLowerCase()).toContain("authorization");
    });
  });
});
