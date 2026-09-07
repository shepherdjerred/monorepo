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
      inputKey: expect.any(String),
      readOnly: false,
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
      inputKey: expect.any(String),
      readOnly: false,
    });
    expect(JSON.stringify(event)).not.toContain("SECRET");
    expect(event.content.length).toBeLessThanOrEqual(1024);
  });

  test("bounds combined content from individually valid maximum summaries", () => {
    // A longer real tool id (rather than an unregistered synthetic one) so
    // the assembled content clears the 1024 cap and actually truncates,
    // while still resolving through the real tool-metadata table that
    // isReadOnlyCall now depends on.
    const event = summarizeToolResultForSession(
      {
        toolCallId: "c".repeat(200),
        toolName: "manage-scheduled-event",
        input: "i".repeat(10_000),
        output: { success: true, message: "r".repeat(10_000) },
      },
      ["manage-scheduled-event"],
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
    inputKey: "key-1",
    readOnly: false,
  };
  const failed = {
    toolCallId: "call-2",
    toolId: "manage-message",
    inputSummary: "{}",
    resultSummary: "Tool reported failure",
    content: "Tool manage-message call call-2 failed",
    success: false,
    inputKey: "key-2",
    readOnly: false,
  };
  // Read-only so it never trips the uncorrected-failure check, isolating the
  // must-cite-something rule these fixtures exist to test.
  const failedRead = {
    toolCallId: "call-3",
    toolId: "get-activity-stats",
    inputSummary: "{}",
    resultSummary: "Tool reported failure",
    content: "Tool get-activity-stats call call-3 failed",
    success: false,
    inputKey: "key-3",
    readOnly: true,
  };
  const succeededRead = {
    toolCallId: "call-4",
    toolId: "get-activity-stats",
    inputSummary: "{}",
    resultSummary: "Leaderboard returned",
    content: "Tool get-activity-stats call call-4 succeeded",
    success: true,
    inputKey: "key-4",
    readOnly: true,
  };

  test("accepts an answer grounded in a successful call", () => {
    expect(() =>
      requireGroundedAnswer(
        {
          answer: "Done.",
          disposition: "supported",
          reliedOnToolCallIds: ["call-1"],
          performedMutation: true,
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
          performedMutation: false,
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
          performedMutation: false,
        },
        [succeeded],
      ),
    ).toThrow("call-invented");
  });

  test("rejects claimed supported work with no successful tool call", () => {
    expect(() =>
      requireGroundedAnswer(
        {
          answer: "Done.",
          disposition: "supported",
          reliedOnToolCallIds: [],
          performedMutation: false,
        },
        [failedRead],
      ),
    ).toThrow("without citing a successful tool call");
  });

  test("rejects supported work citing nothing even when an unrelated call succeeded", () => {
    // A harmless lookup succeeding does not make an unperformed mutation real.
    expect(() =>
      requireGroundedAnswer(
        {
          answer: "Done.",
          disposition: "supported",
          reliedOnToolCallIds: [],
          performedMutation: false,
        },
        [succeeded, failedRead],
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
          performedMutation: false,
        },
        [],
      ),
    ).not.toThrow();
  });

  test("rejects an uncorrected mutation failure even under a conversation disposition", () => {
    // Disposition is model-reported, not verified - a failed write relabeled
    // "conversation" with nothing cited must not slip past the same check a
    // "supported" claim would face.
    expect(() =>
      requireGroundedAnswer(
        {
          answer: "Done.",
          disposition: "conversation",
          reliedOnToolCallIds: [],
          performedMutation: false,
        },
        [failed],
      ),
    ).toThrow("failed and was never retried successfully");
  });

  test("rejects a mutation claim grounded only in a read citation", () => {
    // The concrete hallucination this guards against: the model performs a
    // harmless lookup, then claims an unrelated mutation happened while
    // citing that lookup as its evidence. Citation-success alone cannot
    // catch this - only a second, independent self-report can.
    expect(() =>
      requireGroundedAnswer(
        {
          answer: "Added the role.",
          disposition: "supported",
          reliedOnToolCallIds: ["call-4"],
          performedMutation: true,
        },
        [succeededRead],
      ),
    ).toThrow("cites no successful non-read tool call");
  });

  test("allows an informational answer grounded only in a read citation", () => {
    // The same citation shape is legitimate when the answer never claims a
    // mutation happened - "supported" also covers verifying information.
    expect(() =>
      requireGroundedAnswer(
        {
          answer: "You have 42 messages this week.",
          disposition: "supported",
          reliedOnToolCallIds: ["call-4"],
          performedMutation: false,
        },
        [succeededRead],
      ),
    ).not.toThrow();
  });
});

describe("requireGroundedAnswer: uncorrected failures", () => {
  const unrelatedRead = {
    toolCallId: "call-read",
    toolId: "get-activity-stats",
    inputSummary: "{}",
    resultSummary: "Leaderboard returned",
    content: "Tool get-activity-stats call call-read succeeded",
    success: true,
    inputKey: "read-key",
    readOnly: true,
  };
  // Same inputKey on both: a genuine retry of the identical operation.
  const mutationFailed = {
    toolCallId: "call-mutate-1",
    toolId: "manage-role",
    inputSummary: "{}",
    resultSummary: "Tool reported failure",
    content: "Tool manage-role call call-mutate-1 failed",
    success: false,
    inputKey: "add-regulars-role",
    readOnly: false,
  };
  const mutationSucceeded = {
    toolCallId: "call-mutate-2",
    toolId: "manage-role",
    inputSummary: "{}",
    resultSummary: "Role added",
    content: "Tool manage-role call call-mutate-2 succeeded",
    success: true,
    inputKey: "add-regulars-role",
    readOnly: false,
  };
  const laterReadFailed = {
    toolCallId: "call-read-2",
    toolId: "get-activity-stats",
    inputSummary: "{}",
    resultSummary: "Tool reported failure",
    content: "Tool get-activity-stats call call-read-2 failed",
    success: false,
    inputKey: "read-key-2",
    readOnly: true,
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
          performedMutation: true,
        },
        [unrelatedRead, mutationFailed],
      ),
    ).toThrow("manage-role failed and was never retried successfully");
  });

  test("rejects citing an unrelated success even when the mutation failed first", () => {
    // The same lie in the other order: a citation-relative check ("nothing
    // failed after what I cited") is blind to this, since the failure comes
    // before the citation rather than after it. The rule must not depend on
    // where the citation sits in the timeline.
    expect(() =>
      requireGroundedAnswer(
        {
          answer: "Added the role.",
          disposition: "supported",
          reliedOnToolCallIds: ["call-read"],
          performedMutation: true,
        },
        [mutationFailed, unrelatedRead],
      ),
    ).toThrow("manage-role failed and was never retried successfully");
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
          performedMutation: true,
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
          performedMutation: true,
        },
        [mutationSucceeded, laterReadFailed],
      ),
    ).not.toThrow();
  });

  const createRoleAFailed = {
    toolCallId: "call-create-a",
    toolId: "manage-role",
    inputSummary: '{"action":"create","name":"A"}',
    resultSummary: "Tool reported failure",
    content: "Tool manage-role call call-create-a failed",
    success: false,
    inputKey: "create:A",
    readOnly: false,
  };
  const listSucceeded = {
    toolCallId: "call-list",
    toolId: "manage-role",
    inputSummary: '{"action":"list"}',
    resultSummary: "Roles listed",
    content: "Tool manage-role call call-list succeeded",
    success: true,
    inputKey: "list",
    readOnly: true,
  };
  const createRoleASucceeded = {
    toolCallId: "call-create-a-2",
    toolId: "manage-role",
    inputSummary: '{"action":"create","name":"A"}',
    resultSummary: "Role created",
    content: "Tool manage-role call call-create-a-2 succeeded",
    success: true,
    inputKey: "create:A",
    readOnly: false,
  };
  const createRoleBSucceeded = {
    toolCallId: "call-create-b",
    toolId: "manage-role",
    inputSummary: '{"action":"create","name":"B"}',
    resultSummary: "Role created",
    content: "Tool manage-role call call-create-b succeeded",
    success: true,
    inputKey: "create:B",
    readOnly: false,
  };
  const listFailed = {
    toolCallId: "call-list-failed",
    toolId: "manage-role",
    inputSummary: '{"action":"list"}',
    resultSummary: "Tool reported failure",
    content: "Tool manage-role call call-list-failed failed",
    success: false,
    inputKey: "list-attempt-1",
    readOnly: true,
  };

  test("rejects a failed write corrected only by a different action of the same tool", () => {
    // manage-role exposes both reads (list, get) and writes (create, modify,
    // delete) under one toolId. A later list succeeding is not evidence that
    // an earlier failed create ever happened - only a later create would be.
    expect(() =>
      requireGroundedAnswer(
        {
          answer: "Created the role.",
          disposition: "supported",
          reliedOnToolCallIds: ["call-list"],
          performedMutation: true,
        },
        [createRoleAFailed, listSucceeded],
      ),
    ).toThrow("manage-role failed and was never retried successfully");
  });

  test("rejects a failed create corrected only by creating a different role", () => {
    // Same action, different target: creating role B does not prove role A,
    // which is what actually failed, was ever created.
    expect(() =>
      requireGroundedAnswer(
        {
          answer: "Created role A.",
          disposition: "supported",
          reliedOnToolCallIds: ["call-create-b"],
          performedMutation: true,
        },
        [createRoleAFailed, createRoleBSucceeded],
      ),
    ).toThrow("manage-role failed and was never retried successfully");
  });

  test("allows a failed write corrected by a later success of the exact same operation", () => {
    expect(() =>
      requireGroundedAnswer(
        {
          answer: "Created role A.",
          disposition: "supported",
          reliedOnToolCallIds: ["call-create-a-2"],
          performedMutation: true,
        },
        [createRoleAFailed, createRoleASucceeded],
      ),
    ).not.toThrow();
  });

  test("does not treat a failed read action on a destructive-riskClass tool as uncorrected", () => {
    // manage-role's tool-level riskClass is "destructive" because it can
    // delete roles, but "list" never mutates anything. A failed list must
    // not require its own retry just because the tool it belongs to can also
    // be destructive - only the actual requested mutation (create) does.
    expect(() =>
      requireGroundedAnswer(
        {
          answer: "Created the role.",
          disposition: "supported",
          reliedOnToolCallIds: ["call-create-a-2"],
          performedMutation: true,
        },
        [listFailed, createRoleAFailed, createRoleASucceeded],
      ),
    ).not.toThrow();
  });
});

describe("summarizeToolResultForSession: inputKey", () => {
  test("computes the same key regardless of field order", () => {
    const first = summarizeToolResultForSession(
      {
        toolCallId: "call-1",
        toolName: "manage-message",
        input: { action: "send", channelId: "123" },
        output: { success: true, message: "Sent" },
      },
      registeredToolIds,
    );
    const second = summarizeToolResultForSession(
      {
        toolCallId: "call-2",
        toolName: "manage-message",
        input: { channelId: "123", action: "send" },
        output: { success: true, message: "Sent" },
      },
      registeredToolIds,
    );
    expect(first.inputKey).toBe(second.inputKey);
  });

  test("computes different keys for different input", () => {
    const event = summarizeToolResultForSession(
      {
        toolCallId: "call-1",
        toolName: "manage-message",
        input: { action: "send", channelId: "123" },
        output: { success: true, message: "Sent" },
      },
      registeredToolIds,
    );
    const differentChannel = summarizeToolResultForSession(
      {
        toolCallId: "call-2",
        toolName: "manage-message",
        input: { action: "send", channelId: "456" },
        output: { success: true, message: "Sent" },
      },
      registeredToolIds,
    );
    expect(event.inputKey).not.toBe(differentChannel.inputKey);
  });
});
