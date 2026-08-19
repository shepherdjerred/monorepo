import { describe, expect, test } from "bun:test";
import {
  requireSuccessfulPrimaryTool,
  summarizeToolResultForSession,
} from "@shepherdjerred/birmel/agent-runtime/specialists.ts";
import {
  CORE_SYSTEM_POLICY,
  directInstructions,
  specialistInstructions,
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

describe("capability-grounded execution instructions", () => {
  test("tells unsupported direct turns to state the missing capability plainly", () => {
    const instructions = directInstructions({
      route: "direct",
      disposition: "unsupported",
      primaryToolId: null,
      confidence: 1,
      rationale: "No registered capability",
    });

    expect(instructions).toContain("no registered capability");
    expect(instructions).toContain("State that missing capability plainly");
    expect(instructions).toContain("Do not imply that a safety policy");
  });

  test("allows ordinary supported writes while retaining narrow bulk bans", () => {
    expect(CORE_SYSTEM_POLICY).toContain(
      "Trusted users may request ordinary supported reads and writes",
    );
    expect(CORE_SYSTEM_POLICY).toContain(
      "Refuse only bulk destructive operations and bulk creation",
    );
  });

  test("binds specialist execution to the routed primary tool", () => {
    expect(
      specialistInstructions("editor", {
        route: "editor",
        disposition: "supported",
        primaryToolId: "connect-github",
        confidence: 1,
        rationale: "GitHub status",
      }),
    ).toContain("Primary registered tool: connect-github");
  });

  test("requires the routed primary tool to succeed at runtime", () => {
    const decision = {
      route: "editor" as const,
      disposition: "supported" as const,
      primaryToolId: "connect-github",
      confidence: 1,
      rationale: "GitHub status",
    };
    const supportingTool = {
      toolCallId: "call-list",
      toolId: "list-repos",
      inputSummary: "{}",
      resultSummary: "Repos listed",
      content: "Tool list-repos succeeded",
      success: true,
    };

    expect(() =>
      requireSuccessfulPrimaryTool(decision, [supportingTool]),
    ).toThrow("did not complete its primary tool successfully");
    expect(() =>
      requireSuccessfulPrimaryTool(decision, [
        supportingTool,
        {
          toolCallId: "call-connect",
          toolId: "connect-github",
          inputSummary: '{"action":"status"}',
          resultSummary: "Tool reported failure",
          content: "Tool connect-github failed",
          success: false,
        },
      ]),
    ).toThrow("did not complete its primary tool successfully");
    expect(() =>
      requireSuccessfulPrimaryTool(decision, [
        supportingTool,
        {
          toolCallId: "call-connect",
          toolId: "connect-github",
          inputSummary: '{"action":"status"}',
          resultSummary: "GitHub account is connected",
          content: "Tool connect-github succeeded",
          success: true,
        },
      ]),
    ).not.toThrow();
  });
});
