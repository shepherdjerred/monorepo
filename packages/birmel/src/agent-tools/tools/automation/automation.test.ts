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
import { handleRemind } from "./timer-actions.ts";
import { createAgentJob, editAgentJob } from "./agent-job-actions.ts";
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

const CreatedAgentJobDataSchema = z.object({
  jobId: z.string(),
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
    expect(result.message).toBe("Agent job created");
    expect(getStringField(result.data, "jobId").length).toBeGreaterThan(0);
    // A one-time ISO date is not recurring and carries no cron pattern.
    expect(result.data?.["isRecurring"]).toBe(false);
    expect(result.data?.["cronPattern"]).toBeUndefined();
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
    expect(result.message).toBe("Agent job created");
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
    // Remind rewrites the message to a human-readable confirmation.
    expect(result.message).toContain("Reminder set for");
    expect(result.data?.["scheduledAt"]).toBeTruthy();
  });

  test("rejects reminders when the guild task limit is reached", async () => {
    const result = await handleRemind({
      guildId: testGuildId,
      config: { scheduler: { maxTasksPerGuild: 0 } },
      userId: testUserId,
      when: "in 5 minutes",
      channelId: "test-channel-e2e",
      reminderAction: "Limit test reminder",
      reminderMessage: undefined,
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("Maximum tasks per guild");
  });

  test("lists scheduled tasks", async () => {
    const result = await executeTool(manageTaskTool, {
      action: "list",
      guildId: testGuildId,
      ...testContext,
    });

    expect(result.success).toBe(true);
    // The prior tests scheduled at least three jobs in this guild.
    expect(result.message).toMatch(/^Found \d+ jobs?$/);
    const tasks = result.data?.["tasks"];
    expect(Array.isArray(tasks)).toBe(true);
    if (Array.isArray(tasks)) {
      expect(tasks.length).toBeGreaterThan(0);
      expect(result.data?.["count"]).toBe(tasks.length);
      // Every listed task exposes an id and enabled flag.
      for (const task of tasks) {
        expect(task).toMatchObject({
          jobId: expect.any(String),
          enabled: expect.any(Boolean),
        });
      }
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

    expect(createResult.message).toBe("Agent job created");
    const jobId = createResult.data?.["jobId"];
    expect(jobId).toBeTruthy();

    const cancelResult = await executeTool(manageTaskTool, {
      action: "cancel",
      jobId,
      guildId: testGuildId,
      userId: testUserId,
      ...testContext,
    });

    expect(cancelResult.success).toBe(true);
    expect(cancelResult.message).toBe("Agent job cancelled");

    const job = await prisma.agentJob.findUnique({
      where: { id: String(jobId) },
    });
    expect(job?.status).toBe("cancelled");
  });

  test("rejects cancelling another user's job", async () => {
    const createResult = await executeTool(manageTaskTool, {
      action: "schedule",
      when: "in 1 hour",
      toolId: "execute-shell-command",
      toolInput: { command: "echo", args: ["not yours"] },
      guildId: testGuildId,
      userId: testUserId,
      name: "Owned task",
      ...testContext,
    });
    expect(createResult.success).toBe(true);
    expect(createResult.message).toBe("Agent job created");
    const jobId = createResult.data?.["jobId"];
    expect(jobId).toBeTruthy();

    const cancelResult = await executeTool(manageTaskTool, {
      action: "cancel",
      jobId,
      guildId: testGuildId,
      userId: "different-user-e2e",
      ...testContext,
    });

    expect(cancelResult.success).toBe(false);
    expect(cancelResult.message).toContain("not found or not owned");

    const job = await prisma.agentJob.findUnique({
      where: { id: String(jobId) },
    });
    expect(job?.status).toBe("active");
  });

  test("editing non-schedule fields preserves the next run time", async () => {
    const createResult = await createAgentJob({
      guildId: testGuildId,
      userId: testUserId,
      channelId: "test-channel-e2e",
      scheduleKind: "every",
      scheduleValue: "every 1 hour",
      message: "Preserve schedule test",
      name: "Original schedule name",
    });
    expect(createResult.success).toBe(true);
    const created = CreatedAgentJobDataSchema.parse(createResult.data);
    const before = await prisma.agentJob.findUniqueOrThrow({
      where: { id: created.jobId },
    });
    expect(before.nextRunAt).toBeInstanceOf(Date);

    const editResult = await editAgentJob({
      guildId: testGuildId,
      jobId: created.jobId,
      name: "Renamed schedule",
    });
    expect(editResult.success).toBe(true);

    const after = await prisma.agentJob.findUniqueOrThrow({
      where: { id: created.jobId },
    });
    expect(after.name).toBe("Renamed schedule");
    expect(after.nextRunAt?.toISOString()).toBe(
      before.nextRunAt?.toISOString(),
    );
  });
});

describe.skipIf(Bun.env["BROWSER_ENABLED"] !== "true")(
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
