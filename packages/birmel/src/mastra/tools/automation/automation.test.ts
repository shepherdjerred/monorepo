/**
 * End-to-end tests for all automation tools
 *
 * Tests Phase 1 (Shell), Phase 2 (Scheduler), and Phase 3 (Browser) tools
 *
 * Note: Environment setup (env vars, directories, prisma db push) is handled
 * by the preload script in test-setup.ts, configured in bunfig.toml.
 */

import { describe, test, expect } from "bun:test";
import { z } from "zod";
import { executeShellCommandTool } from "./shell.ts";
import { manageTaskTool } from "./timers.ts";
import { browserAutomationTool } from "./browser.ts";
import { prisma } from "@shepherdjerred/birmel/database/index.ts";

const testContext = {
  runId: "test-run-e2e",
  agentId: "test-agent",
};

type ToolResult = {
  success: boolean;
  message: string;
  data?: Record<string, unknown> | undefined;
};

const ToolResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
});

async function executeTool(
  tool: unknown,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  if (tool == null || typeof tool !== "object" || !("execute" in tool)) {
    throw new TypeError("Tool has no execute function");
  }
  const execute: unknown = tool.execute;
  if (typeof execute !== "function") {
    throw new TypeError("Tool execute is not a function");
  }
  const result: unknown = await Reflect.apply(execute, undefined, [input, {}]);
  return ToolResultSchema.parse(result);
}

function getStringField(
  data: Record<string, unknown> | undefined,
  field: string,
): string {
  if (data == null) {
    return "";
  }
  const value: unknown = data[field];
  if (typeof value === "string") {
    return value;
  }
  return "";
}

describe("Phase 1: Shell Tool", () => {
  test("executes Python code", async () => {
    const result = await executeTool(executeShellCommandTool, {
      command: "python3",
      args: ["-c", "print('Hello from Python')"],
      ...testContext,
    });

    expect(result.success).toBe(true);
    expect(getStringField(result.data, "stdout").trim()).toBe(
      "Hello from Python",
    );
    expect(result.data?.["exitCode"]).toBe(0);
  });

  test("executes Node.js code", async () => {
    const result = await executeTool(executeShellCommandTool, {
      command: "node",
      args: ["-e", "console.log('Hello from Node')"],
      ...testContext,
    });

    expect(result.success).toBe(true);
    expect(getStringField(result.data, "stdout").trim()).toBe(
      "Hello from Node",
    );
    expect(result.data?.["exitCode"]).toBe(0);
  });

  test("executes Bun code", async () => {
    const result = await executeTool(executeShellCommandTool, {
      command: "bun",
      args: ["--version"],
      ...testContext,
    });

    expect(result.success).toBe(true);
    expect(result.data?.["exitCode"]).toBe(0);
    expect(getStringField(result.data, "stdout")).toContain("1.");
  });

  test("handles command timeout", async () => {
    const result = await executeTool(executeShellCommandTool, {
      command: "sleep",
      args: ["5"],
      timeout: 100,
      ...testContext,
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("timed out");
    expect(result.data?.["timedOut"]).toBe(true);
  });

  test("handles command errors", async () => {
    const result = await executeTool(executeShellCommandTool, {
      command: "ls",
      args: ["/nonexistent-directory-xyz"],
      ...testContext,
    });

    expect(result.success).toBe(true); // Non-zero exit is still success
    expect(result.data?.["exitCode"]).not.toBe(0);
    expect(result.data?.["stderr"]).toBeTruthy();
  });
});

describe("Phase 2: Timer/Scheduler Tools", () => {
  const testGuildId = "test-guild-e2e";
  const testUserId = "test-user-e2e";

  test("schedules a one-time task with ISO date", async () => {
    const futureDate = new Date(Date.now() + 60_000).toISOString();

    const result = await executeTool(manageTaskTool, {
      action: "schedule",
      when: futureDate,
      toolId: "execute-shell-command",
      toolInput: { command: "echo", args: ["scheduled test"] },
      guildId: testGuildId,
      userId: testUserId,
      name: "Test scheduled task",
      ...testContext,
    });

    expect(result.success).toBe(true);
    expect(result.data?.["taskId"]).toBeTruthy();
    expect(result.data?.["scheduledAt"]).toBeTruthy();
  });

  test("schedules a task with cron pattern", async () => {
    const result = await executeTool(manageTaskTool, {
      action: "schedule",
      when: "0 9 * * *",
      toolId: "execute-shell-command",
      toolInput: { command: "echo", args: ["daily task"] },
      guildId: testGuildId,
      userId: testUserId,
      name: "Daily cron task",
      ...testContext,
    });

    expect(result.success).toBe(true);
    expect(result.data?.["cronPattern"]).toBe("0 9 * * *");
    expect(result.data?.["isRecurring"]).toBe(true);
  });

  test("schedules a reminder with natural language", async () => {
    const result = await executeTool(manageTaskTool, {
      action: "remind",
      when: "in 5 minutes",
      guildId: testGuildId,
      channelId: "test-channel-e2e",
      userId: testUserId,
      reminderAction: "Test reminder",
      ...testContext,
    });

    expect(result.success).toBe(true);
    expect(result.data?.["scheduledAt"]).toBeTruthy();
  });

  test("lists scheduled tasks", async () => {
    const result = await executeTool(manageTaskTool, {
      action: "list",
      guildId: testGuildId,
      ...testContext,
    });

    expect(result.success).toBe(true);
    expect(result.data?.["tasks"]).toBeTruthy();
    const tasks = result.data?.["tasks"];
    expect(Array.isArray(tasks)).toBe(true);
    if (Array.isArray(tasks)) {
      expect(tasks.length).toBeGreaterThan(0);
    }
  });

  test("cancels a scheduled task", async () => {
    const createResult = await executeTool(manageTaskTool, {
      action: "schedule",
      when: "in 1 hour",
      toolId: "execute-shell-command",
      toolInput: { command: "echo", args: ["to be cancelled"] },
      guildId: testGuildId,
      userId: testUserId,
      name: "Task to cancel",
      ...testContext,
    });

    const taskId = createResult.data?.["taskId"];
    expect(taskId).toBeTruthy();

    const cancelResult = await executeTool(manageTaskTool, {
      action: "cancel",
      taskId,
      guildId: testGuildId,
      userId: testUserId,
      ...testContext,
    });

    expect(cancelResult.success).toBe(true);

    const task = await prisma.scheduledTask.findUnique({
      where: { id: Number(taskId) },
    });
    expect(task?.enabled).toBe(false);
  });
});

describe.skipIf(Bun.env["BROWSER_ENABLED"] === "false")(
  "Phase 3: Browser Tools",
  () => {
    test("navigates to a URL", async () => {
      const result = await executeTool(browserAutomationTool, {
        action: "navigate",
        url: "https://example.com",
        ...testContext,
      });

      expect(result.success).toBe(true);
      expect(result.data?.["url"]).toBe("https://example.com/");
      expect(result.data?.["title"]).toBeTruthy();
    });

    test("gets text content from page", async () => {
      await executeTool(browserAutomationTool, {
        action: "navigate",
        url: "https://example.com",
        ...testContext,
      });

      const result = await executeTool(browserAutomationTool, {
        action: "get-text",
        selector: "h1",
        ...testContext,
      });

      expect(result.success).toBe(true);
      expect(getStringField(result.data, "text")).toContain("Example Domain");
    });

    test("captures screenshot", async () => {
      await executeTool(browserAutomationTool, {
        action: "navigate",
        url: "https://example.com",
        ...testContext,
      });

      const result = await executeTool(browserAutomationTool, {
        action: "screenshot",
        filename: "test-e2e-screenshot.png",
        ...testContext,
      });

      expect(result.success).toBe(true);
      expect(result.data?.["filename"]).toBe("test-e2e-screenshot.png");
      expect(result.data?.["path"]).toBeTruthy();

      const fileExists = await Bun.file(
        getStringField(result.data, "path"),
      ).exists();
      expect(fileExists).toBe(true);
    });

    test("types into input field", async () => {
      await executeTool(browserAutomationTool, {
        action: "navigate",
        url: "https://example.com",
        ...testContext,
      });

      const result = await executeTool(browserAutomationTool, {
        action: "type",
        selector: "input[name='q']",
        text: "test search",
        timeout: 1000,
        ...testContext,
      });

      expect(result.success).toBe(false);
    });

    test("closes browser session", async () => {
      const result = await executeTool(browserAutomationTool, {
        action: "close",
        ...testContext,
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain("closed");
    });
  },
);

console.log("All end-to-end tests completed!");
