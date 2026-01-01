/**
 * End-to-end tests for all automation tools
 *
 * Tests Phase 1 (Shell), Phase 2 (Scheduler), and Phase 3 (Browser) tools
 *
 * Note: Environment setup (env vars, directories, prisma db push) is handled
 * by the preload script in test-setup.ts, configured in bunfig.toml.
 */

import { describe, test, expect } from "bun:test";
import {
  executeShellCommandTool,
  manageTaskTool,
  browserAutomationTool,
} from "./index.js";
import { prisma } from "../../../database/index.js";
import { existsSync } from "node:fs";

const testContext = {
  runId: "test-run-e2e",
  agentId: "test-agent",
};

describe("Phase 1: Shell Tool", () => {
  test("executes Python code", async () => {
    const result = await (executeShellCommandTool as any).execute({
      command: "python3",
      args: ["-c", "print('Hello from Python')"],
      ...testContext,
    });

    expect(result.success).toBe(true);
    expect(result.data?.stdout.trim()).toBe("Hello from Python");
    expect(result.data?.exitCode).toBe(0);
  });

  test("executes Node.js code", async () => {
    const result = await (executeShellCommandTool as any).execute({
      command: "node",
      args: ["-e", "console.log('Hello from Node')"],
      ...testContext,
    });

    expect(result.success).toBe(true);
    expect(result.data?.stdout.trim()).toBe("Hello from Node");
    expect(result.data?.exitCode).toBe(0);
  });

  test("executes Bun code", async () => {
    const result = await (executeShellCommandTool as any).execute({
      command: "bun",
      args: ["--version"],
      ...testContext,
    });

    expect(result.success).toBe(true);
    expect(result.data?.exitCode).toBe(0);
    expect(result.data?.stdout).toContain("1.");
  });

  test("handles command timeout", async () => {
    const result = await (executeShellCommandTool as any).execute({
      command: "sleep",
      args: ["5"],
      timeout: 100,
      ...testContext,
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("timed out");
    expect(result.data?.timedOut).toBe(true);
  });

  test("handles command errors", async () => {
    const result = await (executeShellCommandTool as any).execute({
      command: "ls",
      args: ["/nonexistent-directory-xyz"],
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

    const result = await (manageTaskTool as any).execute({
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
    expect(result.data?.taskId).toBeTruthy();
    expect(result.data?.scheduledAt).toBeTruthy();
  });

  test("schedules a task with cron pattern", async () => {
    const result = await (manageTaskTool as any).execute({
      action: "schedule",
      when: "0 9 * * *", // Daily at 9am
      toolId: "execute-shell-command",
      toolInput: { command: "echo", args: ["daily task"] },
      guildId: testGuildId,
      userId: testUserId,
      name: "Daily cron task",
      ...testContext,
    });

    expect(result.success).toBe(true);
    expect(result.data?.cronPattern).toBe("0 9 * * *");
    expect(result.data?.isRecurring).toBe(true);
  });

  test("schedules a reminder with natural language", async () => {
    const result = await (manageTaskTool as any).execute({
      action: "remind",
      when: "in 5 minutes",
      guildId: testGuildId,
      channelId: "test-channel-e2e",
      userId: testUserId,
      reminderAction: "Test reminder",
      ...testContext,
    });

    expect(result.success).toBe(true);
    expect(result.data?.scheduledAt).toBeTruthy();
  });

  test("lists scheduled tasks", async () => {
    const result = await (manageTaskTool as any).execute({
      action: "list",
      guildId: testGuildId,
      ...testContext,
    });

    expect(result.success).toBe(true);
    expect(result.data?.tasks).toBeTruthy();
    expect(result.data?.tasks.length).toBeGreaterThan(0);
  });

  test("cancels a scheduled task", async () => {
    // First create a task
    const createResult = await (manageTaskTool as any).execute({
      action: "schedule",
      when: "in 1 hour",
      toolId: "execute-shell-command",
      toolInput: { command: "echo", args: ["to be cancelled"] },
      guildId: testGuildId,
      userId: testUserId,
      name: "Task to cancel",
      ...testContext,
    });

    const taskId = createResult.data?.taskId;
    expect(taskId).toBeTruthy();

    // Then cancel it
    const cancelResult = await (manageTaskTool as any).execute({
      action: "cancel",
      taskId: taskId!,
      guildId: testGuildId,
      userId: testUserId,
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

describe.skipIf(process.env["BROWSER_ENABLED"] === "false")("Phase 3: Browser Tools", () => {
  test("navigates to a URL", async () => {
    const result = await (browserAutomationTool as any).execute({
      action: "navigate",
      url: "https://example.com",
      ...testContext,
    });

    expect(result.success).toBe(true);
    expect(result.data?.url).toBe("https://example.com/");
    expect(result.data?.title).toBeTruthy();
  });

  test("gets text content from page", async () => {
    // Navigate first
    await (browserAutomationTool as any).execute({
      action: "navigate",
      url: "https://example.com",
      ...testContext,
    });

    // Get text
    const result = await (browserAutomationTool as any).execute({
      action: "get-text",
      selector: "h1",
      ...testContext,
    });

    expect(result.success).toBe(true);
    expect(result.data?.text).toContain("Example Domain");
  });

  test("captures screenshot", async () => {
    // Navigate first
    await (browserAutomationTool as any).execute({
      action: "navigate",
      url: "https://example.com",
      ...testContext,
    });

    // Take screenshot
    const result = await (browserAutomationTool as any).execute({
      action: "screenshot",
      filename: "test-e2e-screenshot.png",
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
    await (browserAutomationTool as any).execute({
      action: "navigate",
      url: "https://example.com",
      ...testContext,
    });

    // This will fail to find the selector, but should handle gracefully
    const result = await (browserAutomationTool as any).execute({
      action: "type",
      selector: "input[name='q']",
      text: "test search",
      timeout: 1000,
      ...testContext,
    });

    // Expect failure since example.com doesn't have a search input
    expect(result.success).toBe(false);
  });

  test("closes browser session", async () => {
    const result = await (browserAutomationTool as any).execute({
      action: "close",
      ...testContext,
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("closed");
  });
});

console.log("✅ All end-to-end tests completed!");
