import { describe, expect, test } from "bun:test";
import type { AgentExecutionResult } from "@shepherdjerred/birmel/agent-runtime/specialists.ts";
import {
  executeIsolatedAgentJob,
  type IsolatedJobAgentDependencies,
} from "@shepherdjerred/birmel/agent-runtime/job-agent.ts";
import type { AgentJobExecution } from "@shepherdjerred/birmel/scheduler/jobs/scheduled-tasks.ts";

const execution: AgentJobExecution = {
  jobId: "job-1",
  runId: "run-1",
  claimId: "claim-1",
  guildId: "123456789012345678",
  actorUserId: "234567890123456789",
  sessionId: "session-1",
  model: "gpt-5-mini",
  reasoningEffort: "high",
  textVerbosity: "low",
  timeoutMs: 45_000,
  requestContext: {
    guildId: "123456789012345678",
    userId: "234567890123456789",
    sourceChannelId: "345678901234567890",
    sourceMessageId: "456789012345678901",
    ownsSourceReply: false,
  },
};

const agentResult: AgentExecutionResult = {
  text: "scheduled result",
  finishReason: "stop",
  inputTokens: 20,
  outputTokens: 5,
  stepCount: 2,
  toolEvents: [],
};

describe("isolated scheduled agent", () => {
  test("receives bounded session context, persona, and stored model settings", async () => {
    let observedPacket:
      | Parameters<IsolatedJobAgentDependencies["executeAgent"]>[0]
      | undefined;
    let observedOptions:
      | Parameters<IsolatedJobAgentDependencies["executeAgent"]>[1]
      | undefined;
    const dependencies: IsolatedJobAgentDependencies = {
      getPersona: async () => "virmel",
      getSession: async () => ({
        summary: "Earlier summary",
        events: [{ sequence: 3, role: "user", content: "continue the task" }],
      }),
      executeAgent: async (packet, options) => {
        observedPacket = packet;
        observedOptions = options;
        return agentResult;
      },
    };

    const result = await executeIsolatedAgentJob(
      "finish this later",
      execution,
      dependencies,
    );

    expect(observedPacket?.context).toBe(
      "Earlier summary\n\n3 user: continue the task",
    );
    expect(observedPacket?.personaId).toBe("virmel");
    expect(observedPacket?.persona).toContain("Elected persona: virmel");
    expect(observedPacket?.userId).toBe(execution.actorUserId);
    expect(observedOptions).toEqual({
      model: "gpt-5-mini",
      reasoningEffort: "high",
      textVerbosity: "low",
      timeoutMs: 45_000,
    });
    expect(result).toEqual({
      message: "scheduled result",
      data: {
        finishReason: "stop",
        inputTokens: 20,
        outputTokens: 5,
        stepCount: 2,
      },
    });
  });

  test("preserves a definitely unapplied isolated tool failure", async () => {
    const dependencies: IsolatedJobAgentDependencies = {
      getPersona: async () => "virmel",
      getSession: async () => ({ summary: undefined, events: [] }),
      executeAgent: async () => ({
        ...agentResult,
        toolEvents: [
          {
            toolId: "manage-message",
            content: "Tool manage-message failed",
            success: false,
            effectDisposition: "not_applied",
          },
        ],
      }),
    };

    await expect(
      executeIsolatedAgentJob("send this later", execution, dependencies),
    ).resolves.toEqual({
      message: "Isolated scheduled agent tool execution failed: manage-message",
      data: {
        finishReason: "stop",
        inputTokens: 20,
        outputTokens: 5,
        stepCount: 2,
        effectDisposition: "not_applied",
      },
    });
  });

  test("caps the summary instead of evicting it from session context", async () => {
    const oversizedSummary = "old".repeat(10_000);
    let observedContext = "";
    const dependencies: IsolatedJobAgentDependencies = {
      getPersona: async () => "virmel",
      getSession: async () => ({
        summary: oversizedSummary,
        events: [],
      }),
      executeAgent: async (packet) => {
        observedContext = packet.context;
        return agentResult;
      },
    };

    await executeIsolatedAgentJob("finish this later", execution, dependencies);

    expect(observedContext).toHaveLength(8000);
    expect(observedContext).toBe(oversizedSummary.slice(0, 8000));
  });

  test("reserves summary space and keeps the newest whole events that fit", async () => {
    const summary = "s".repeat(8000);
    let observedContext = "";
    const dependencies: IsolatedJobAgentDependencies = {
      getPersona: async () => "virmel",
      getSession: async () => ({
        summary,
        events: [
          { sequence: 1, role: "user", content: "a".repeat(7000) },
          { sequence: 2, role: "assistant", content: "b".repeat(7000) },
        ],
      }),
      executeAgent: async (packet) => {
        observedContext = packet.context;
        return agentResult;
      },
    };

    await executeIsolatedAgentJob("finish this later", execution, dependencies);

    expect(observedContext.startsWith(`${summary}\n\n`)).toBeTrue();
    expect(observedContext).toContain("2 assistant:");
    expect(observedContext).not.toContain("1 user:");
    expect(observedContext.length).toBeLessThanOrEqual(20_000);
  });
});
