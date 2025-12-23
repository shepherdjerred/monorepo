/**
 * End-to-end tests for all automation tools
 *
 * Tests Phase 1 (Shell), Phase 2 (Scheduler), and Phase 3 (Browser) tools
 */

import { describe, test, expect } from "bun:test";
import {
  executeShellCommandTool,
  scheduleTaskTool,
  listScheduledTasksTool,
  cancelScheduledTaskTool,
  scheduleReminderTool,
  browserNavigateTool,
  browserScreenshotTool,
  browserTypeTool,
  browserGetTextTool,
  browserCloseTool,
} from "./index.js";
import { prisma } from "../../../database/index.js";
import { existsSync } from "node:fs";

// Set up minimal test environment
process.env["DISCORD_TOKEN"] = "test-token";
process.env["DISCORD_CLIENT_ID"] = "test-client-id";
process.env["OPENAI_API_KEY"] = "test-key";
process.env["DATABASE_PATH"] = ":memory:";
process.env["DATABASE_URL"] = "file::memory:?cache=shared";
process.env["OPS_DATABASE_URL"] = "file:./data/test-ops.db";
process.env["SHELL_ENABLED"] = "true";
process.env["SCHEDULER_ENABLED"] = "true";
process.env["BROWSER_ENABLED"] = "true";
process.env["BROWSER_HEADLESS"] = "true";

const testContext = {
  runId: "test-run-e2e",
  agentId: "test-agent",
};

describe("Phase 1: Shell Tool", () => {
  test("executes Python code", async () => {
    const result = await (executeShellCommandTool as any).execute({
      context: {
        command: "python3",
        args: ["-c", "print('Hello from Python')"],
      },
      ...testContext,
    });

    expect(result.success).toBe(true);
    expect(result.data?.stdout.trim()).toBe("Hello from Python");
    expect(result.data?.exitCode).toBe(0);
  });

  test("executes Node.js code", async () => {
    const result = await (executeShellCommandTool as any).execute({
      context: {
        command: "node",
        args: ["-e", "console.log('Hello from Node')"],
      },
      ...testContext,
    });

    expect(result.success).toBe(true);
    expect(result.data?.stdout.trim()).toBe("Hello from Node");
    expect(result.data?.exitCode).toBe(0);
  });

  test("executes Bun code", async () => {
    const result = await (executeShellCommandTool as any).execute({
      context: {
        command: "bun",
        args: ["--version"],
      },
      ...testContext,
    });

    expect(result.success).toBe(true);
    expect(result.data?.exitCode).toBe(0);
    expect(result.data?.stdout).toContain("1.");
  });

  test("handles command timeout", async () => {
    const result = await (executeShellCommandTool as any).execute({
      context: {
        command: "sleep",
        args: ["5"],
        timeout: 100,
      },
      ...testContext,
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("timed out");
    expect(result.data?.timedOut).toBe(true);
  });

  test("handles command errors", async () => {
    const result = await (executeShellCommandTool as any).execute({
      context: {
        command: "ls",
        args: ["/nonexistent-directory-xyz"],
      },
      ...testContext,
    });

    expect(result.success).toBe(true); // Non-zero exit is still success
    expect(result.data?.exitCode).not.toBe(0);
    expect(result.data?.stderr).toBeTruthy();
  });
});

describe("Phase 2: Timer/Scheduler Tools", () => {
  const testGuildId = "test-guild-e2e";
  const testUserId = "test-user-e2e";

  // Note: These tests require the ScheduledTask table to exist in the database
  // When running with an in-memory database, migrations must be applied first

  test("schedules a one-time task with ISO date", async () => {
    const futureDate = new Date(Date.now() + 60000).toISOString();

    const result = await (scheduleTaskTool as any).execute({
      context: {
        when: futureDate,
        toolId: "execute-shell-command",
        toolInput: { command: "echo", args: ["scheduled test"] },
        guildId: testGuildId,
        userId: testUserId,
        name: "Test scheduled task",
      },
      ...testContext,
    });

    expect(result.success).toBe(true);
    expect(result.data?.taskId).toBeTruthy();
    expect(result.data?.scheduledAt).toBeTruthy();
  });

  test("schedules a task with cron pattern", async () => {
    const result = await (scheduleTaskTool as any).execute({
      context: {
        when: "0 9 * * *", // Daily at 9am
        toolId: "execute-shell-command",
        toolInput: { command: "echo", args: ["daily task"] },
        guildId: testGuildId,
        userId: testUserId,
        name: "Daily cron task",
        recurring: true,
      },
      ...testContext,
    });

    expect(result.success).toBe(true);
    expect(result.data?.cronPattern).toBe("0 9 * * *");
    expect(result.data?.isRecurring).toBe(true);
  });

  test("schedules a reminder with natural language", async () => {
    const result = await (scheduleReminderTool as any).execute({
      context: {
        when: "in 5 minutes",
        action: "remind",
        guildId: testGuildId,
        userId: testUserId,
        message: "Test reminder",
      },
      ...testContext,
    });

    expect(result.success).toBe(true);
    expect(result.data?.scheduledAt).toBeTruthy();
  });

  test("lists scheduled tasks", async () => {
    const result = await (listScheduledTasksTool as any).execute({
      context: {
        guildId: testGuildId,
      },
      ...testContext,
    });

    expect(result.success).toBe(true);
    expect(result.data?.tasks).toBeTruthy();
    expect(result.data?.tasks.length).toBeGreaterThan(0);
  });

  test("cancels a scheduled task", async () => {
    // First create a task
    const createResult = await (scheduleTaskTool as any).execute({
      context: {
        when: "in 1 hour",
        toolId: "execute-shell-command",
        toolInput: { command: "echo", args: ["to be cancelled"] },
        guildId: testGuildId,
        userId: testUserId,
        name: "Task to cancel",
      },
      ...testContext,
    });

    const taskId = createResult.data?.taskId;
    expect(taskId).toBeTruthy();

    // Then cancel it
    const cancelResult = await (cancelScheduledTaskTool as any).execute({
      context: {
        taskId: taskId!,
        guildId: testGuildId,
        userId: testUserId,
      },
      ...testContext,
    });

    expect(cancelResult.success).toBe(true);

    // Verify it's disabled
    const task = await prisma.scheduledTask.findUnique({
      where: { id: taskId },
    });
    expect(task?.enabled).toBe(false);
  });
});

describe("Phase 3: Browser Tools", () => {
  test("navigates to a URL", async () => {
    const result = await (browserNavigateTool as any).execute({
      context: {
        url: "https://example.com",
      },
      ...testContext,
    });

    expect(result.success).toBe(true);
    expect(result.data?.url).toBe("https://example.com/");
    expect(result.data?.title).toBeTruthy();
  });

  test("gets text content from page", async () => {
    // Navigate first
    await (browserNavigateTool as any).execute({
      context: {
        url: "https://example.com",
      },
      ...testContext,
    });

    // Get text
    const result = await (browserGetTextTool as any).execute({
      context: {
        selector: "h1",
      },
      ...testContext,
    });

    expect(result.success).toBe(true);
    expect(result.data?.text).toContain("Example Domain");
  });

  test("captures screenshot", async () => {
    // Navigate first
    await (browserNavigateTool as any).execute({
      context: {
        url: "https://example.com",
      },
      ...testContext,
    });

    // Take screenshot
    const result = await (browserScreenshotTool as any).execute({
      context: {
        filename: "test-e2e-screenshot.png",
      },
      ...testContext,
    });

    expect(result.success).toBe(true);
    expect(result.data?.filename).toBe("test-e2e-screenshot.png");
    expect(result.data?.path).toBeTruthy();

    // Verify file exists
    const fileExists = existsSync(result.data!.path);
    expect(fileExists).toBe(true);
  });

  test("types into input field", async () => {
    // This test would need a page with an input field
    // For now, just verify the tool doesn't error
    await (browserNavigateTool as any).execute({
      context: {
        url: "https://example.com",
      },
      ...testContext,
    });

    // This will fail to find the selector, but should handle gracefully
    const result = await (browserTypeTool as any).execute({
      context: {
        selector: "input[name='q']",
        text: "test search",
        timeout: 1000,
      },
      ...testContext,
    });

    // Expect failure since example.com doesn't have a search input
    expect(result.success).toBe(false);
  });

  test("closes browser session", async () => {
    const result = await (browserCloseTool as any).execute({
      context: {},
      ...testContext,
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("closed");
  });
});

console.log("✅ All end-to-end tests completed!");
