import { describe, expect, test } from "bun:test";
import { summarizeToolResultForSession } from "@shepherdjerred/birmel/agent-runtime/specialists.ts";

const registeredToolIds = ["manage-message"];

describe("summarizeToolResultForSession", () => {
  test("records a successful validated tool outcome", () => {
    expect(
      summarizeToolResultForSession(
        {
          toolName: "manage-message",
          output: { success: true, message: "Message sent" },
        },
        registeredToolIds,
      ),
    ).toEqual({
      toolId: "manage-message",
      content: "Tool manage-message succeeded",
    });
  });

  test("records a validated unsuccessful outcome without result content", () => {
    const event = summarizeToolResultForSession(
      {
        toolName: "manage-message",
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
      toolId: "manage-message",
      content: "Tool manage-message failed",
    });
    expect(JSON.stringify(event)).not.toContain("SECRET");
    expect(event.content.length).toBeLessThanOrEqual(96);
  });

  test("rejects a malformed tool outcome", () => {
    expect(() =>
      summarizeToolResultForSession(
        {
          toolName: "manage-message",
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
          toolName: "unknown-tool",
          output: { success: true },
        },
        registeredToolIds,
      ),
    ).toThrow("AI SDK returned an unregistered tool result: unknown-tool");
  });
});
