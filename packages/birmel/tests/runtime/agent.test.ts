import { describe, expect, test } from "vitest";
import {
  requireGroundedAnswer,
  summarizeToolResultForSession,
} from "@shepherdjerred/birmel/agent-runtime/agent.ts";
import {
  AGENT_INSTRUCTIONS,
  CORE_SYSTEM_POLICY,
} from "@shepherdjerred/birmel/agent-runtime/prompts.ts";

const registeredToolIds = ["manage-message"];

describe("summarizeToolResultForSession", () => {
  test("records a successful validated tool outcome", () => {
    expect(
      summarizeToolResultForSession(
        {
          toolCallId: "call-1",
          toolName: "manage-message",
          input: { channelId: "123" },
          output: { success: true, message: "Message sent" },
        },
        registeredToolIds,
      ),
    ).toEqual({
      toolCallId: "call-1",
      toolId: "manage-message",
      inputSummary: '{"channelId":"123"}',
      resultSummary: "Message sent",
      content:
        'Tool manage-message call call-1 succeeded; input={"channelId":"123"}; result=Message sent',
      success: true,
    });
  });

  test("records a validated unsuccessful outcome without result content", () => {
    const event = summarizeToolResultForSession(
      {
        toolCallId: "call-2",
        toolName: "manage-message",
        input: { token: "SECRET_TOOL_TOKEN" },
        output: {
          success: false,
          message: "SECRET_FAILURE_DETAIL",
          data: { token: "SECRET_TOOL_TOKEN", body: "x".repeat(10_000) },
        },
        extraProviderData: "SECRET_PROVIDER_DATA",
      },
      registeredToolIds,
    );

    expect(event).toEqual({
      toolCallId: "call-2",
      toolId: "manage-message",
      inputSummary: '{"token":"[REDACTED]"}',
      resultSummary: "Tool reported failure",
      content:
        'Tool manage-message call call-2 failed; input={"token":"[REDACTED]"}; result=Tool reported failure',
      success: false,
    });
    expect(JSON.stringify(event)).not.toContain("SECRET");
    expect(event.content.length).toBeLessThanOrEqual(1024);
  });

  test("bounds combined content from individually valid maximum summaries", () => {
    const toolId = "a".repeat(64);
    const event = summarizeToolResultForSession(
      {
        toolCallId: "c".repeat(200),
        toolName: toolId,
        input: "i".repeat(10_000),
        output: { success: true, message: "r".repeat(10_000) },
      },
      [toolId],
    );

    expect(event.inputSummary.length).toBe(384);
    expect(event.resultSummary.length).toBe(384);
    expect(event.content.length).toBe(1024);
    expect(event.content.endsWith("…")).toBe(true);
  });

  test("rejects a malformed tool outcome", () => {
    expect(() =>
      summarizeToolResultForSession(
        {
          toolCallId: "call-3",
          toolName: "manage-message",
          input: {},
          output: { message: "Missing success status" },
        },
        registeredToolIds,
      ),
    ).toThrow();
  });

  test("rejects a result for an unregistered tool", () => {
    expect(() =>
      summarizeToolResultForSession(
        {
          toolCallId: "call-4",
          toolName: "unknown-tool",
          input: {},
          output: { success: true, message: "Unknown result" },
        },
        registeredToolIds,
      ),
    ).toThrow("AI SDK returned an unregistered tool result: unknown-tool");
  });
});

describe("agent instructions", () => {
  test("tells the agent that changing approach mid-turn is expected", () => {
    expect(AGENT_INSTRUCTIONS).toContain(
      "let what you find change your approach",
    );
    expect(AGENT_INSTRUCTIONS).toContain("it is not a failure");
  });

  test("keeps unsupported work an honest limitation, not a refusal", () => {
    expect(AGENT_INSTRUCTIONS).toContain("no registered tool can do it");
    expect(AGENT_INSTRUCTIONS).toContain(
      "do not imply a safety policy or permission check caused it",
    );
  });

  test("allows ordinary supported writes while retaining narrow bulk bans", () => {
    expect(CORE_SYSTEM_POLICY).toContain(
      "Trusted users may request ordinary supported reads and writes",
    );
    expect(CORE_SYSTEM_POLICY).toContain(
      "Refuse only bulk destructive operations and bulk creation",
    );
  });
});

describe("requireGroundedAnswer", () => {
  const succeeded = {
    toolCallId: "call-1",
    toolId: "manage-message",
    inputSummary: "{}",
    resultSummary: "Sent",
    content: "Tool manage-message call call-1 succeeded",
    success: true,
  };
  const failed = {
    toolCallId: "call-2",
    toolId: "manage-message",
    inputSummary: "{}",
    resultSummary: "Tool reported failure",
    content: "Tool manage-message call call-2 failed",
    success: false,
  };

  test("accepts an answer grounded in a successful call", () => {
    expect(() =>
      requireGroundedAnswer(
        {
          answer: "Done.",
          disposition: "supported",
          reliedOnToolCallIds: ["call-1"],
        },
        [succeeded],
      ),
    ).not.toThrow();
  });

  test("rejects an answer citing a call that failed", () => {
    expect(() =>
      requireGroundedAnswer(
        {
          answer: "Done.",
          disposition: "supported",
          reliedOnToolCallIds: ["call-2"],
        },
        [succeeded, failed],
      ),
    ).toThrow("did not succeed this turn");
  });

  test("rejects an answer citing a call that never happened", () => {
    expect(() =>
      requireGroundedAnswer(
        {
          answer: "Done.",
          disposition: "supported",
          reliedOnToolCallIds: ["call-invented"],
        },
        [succeeded],
      ),
    ).toThrow("call-invented");
  });

  test("rejects claimed supported work with no successful tool call", () => {
    expect(() =>
      requireGroundedAnswer(
        { answer: "Done.", disposition: "supported", reliedOnToolCallIds: [] },
        [failed],
      ),
    ).toThrow("without citing a successful tool call");
  });

  test("rejects supported work citing nothing even when an unrelated call succeeded", () => {
    // A harmless lookup succeeding does not make an unperformed mutation real.
    expect(() =>
      requireGroundedAnswer(
        { answer: "Done.", disposition: "supported", reliedOnToolCallIds: [] },
        [succeeded, failed],
      ),
    ).toThrow("without citing a successful tool call");
  });

  test("allows tool-free conversation to cite nothing", () => {
    expect(() =>
      requireGroundedAnswer(
        {
          answer: "Hello.",
          disposition: "conversation",
          reliedOnToolCallIds: [],
        },
        [],
      ),
    ).not.toThrow();
  });

  const unrelatedRead = {
    toolCallId: "call-read",
    toolId: "get-activity-stats",
    inputSummary: "{}",
    resultSummary: "Leaderboard returned",
    content: "Tool get-activity-stats call call-read succeeded",
    success: true,
  };
  const mutationFailed = {
    toolCallId: "call-mutate-1",
    toolId: "manage-role",
    inputSummary: "{}",
    resultSummary: "Tool reported failure",
    content: "Tool manage-role call call-mutate-1 failed",
    success: false,
  };
  const mutationSucceeded = {
    toolCallId: "call-mutate-2",
    toolId: "manage-role",
    inputSummary: "{}",
    resultSummary: "Role added",
    content: "Tool manage-role call call-mutate-2 succeeded",
    success: true,
  };
  const laterReadFailed = {
    toolCallId: "call-read-2",
    toolId: "get-activity-stats",
    inputSummary: "{}",
    resultSummary: "Tool reported failure",
    content: "Tool get-activity-stats call call-read-2 failed",
    success: false,
  };

  test("rejects citing an unrelated success while the real mutation failed later", () => {
    // The concrete hallucination this guards against: the model reads
    // something harmless, then the mutation it was actually asked to perform
    // fails - but it cites the harmless read as its evidence anyway.
    expect(() =>
      requireGroundedAnswer(
        {
          answer: "Added the role.",
          disposition: "supported",
          reliedOnToolCallIds: ["call-read"],
        },
        [unrelatedRead, mutationFailed],
      ),
    ).toThrow("manage-role failed after the cited evidence");
  });

  test("allows citing the mutation that actually succeeded after an earlier failed attempt", () => {
    // Trying a tool, seeing it fail, and retrying is an ordinary path through
    // a turn - the citation just has to point at the call that worked.
    expect(() =>
      requireGroundedAnswer(
        {
          answer: "Added the role.",
          disposition: "supported",
          reliedOnToolCallIds: ["call-mutate-2"],
        },
        [unrelatedRead, mutationFailed, mutationSucceeded],
      ),
    ).not.toThrow();
  });

  test("does not reject a citation over an unrelated read that fails afterward", () => {
    // A failed read after the citation says nothing about whether the cited
    // mutation actually happened - only a failed write/destructive/
    // code-execution call after the citation is contradictory.
    expect(() =>
      requireGroundedAnswer(
        {
          answer: "Added the role.",
          disposition: "supported",
          reliedOnToolCallIds: ["call-mutate-2"],
        },
        [mutationSucceeded, laterReadFailed],
      ),
    ).not.toThrow();
  });
});
