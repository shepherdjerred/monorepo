import { beforeAll, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { runWithRequestContext } from "@shepherdjerred/birmel/agent-tools/tools/request-context.ts";
import { getConfig, resetConfig } from "@shepherdjerred/birmel/config/index.ts";
import { browserAutomationTool } from "./browser.ts";
import { executeShellCommandTool } from "./shell.ts";

beforeAll(() => {
  Bun.env["DISCORD_CLIENT_ID"] = "123456789012345678";
  resetConfig();
});

const ToolResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
});
const ExecutableToolSchema = z.object({ execute: z.function() }).loose();

async function executeTool(tool: unknown, input: Record<string, unknown>) {
  const executable = ExecutableToolSchema.parse(tool);
  const actor = z
    .string()
    .regex(/^\d+$/)
    .parse(getConfig().authority.trustedUserIds[0]);
  const result = await runWithRequestContext(
    {
      guildId: "123456789012345678",
      sourceChannelId: "223456789012345678",
      sourceMessageId: "323456789012345678",
      userId: actor,
    },
    async () => await Reflect.apply(executable.execute, undefined, [input, {}]),
  );
  return ToolResultSchema.parse(result);
}

function stringField(
  data: Record<string, unknown> | undefined,
  field: string,
): string {
  const parsed = z.string().safeParse(data?.[field]);
  return parsed.success ? parsed.data : "";
}

describe("shell automation", () => {
  test("executes Python, Node, and Bun commands", async () => {
    const commands = [
      {
        command: "python3",
        args: ["-c", "print('python-ok')"],
        expected: "python-ok",
      },
      {
        command: "node",
        args: ["-e", "console.log('node-ok')"],
        expected: "node-ok",
      },
      { command: "bun", args: ["--version"], expected: "1." },
    ];
    for (const command of commands) {
      const result = await executeTool(executeShellCommandTool, command);
      expect(result.success).toBe(true);
      expect(stringField(result.data, "stdout")).toContain(command.expected);
      expect(result.data?.["exitCode"]).toBe(0);
    }
  });

  test("reports timeout and non-zero command results", async () => {
    const timedOut = await executeTool(executeShellCommandTool, {
      command: "sleep",
      args: ["5"],
      timeout: 100,
    });
    expect(timedOut.success).toBe(false);
    expect(timedOut.message).toContain("timed out");

    const nonzero = await executeTool(executeShellCommandTool, {
      command: "ls",
      args: ["/nonexistent-directory-xyz"],
    });
    expect(nonzero.success).toBe(true);
    expect(nonzero.data?.["exitCode"]).not.toBe(0);
  });
});

describe("PinchTab HTTP boundary", () => {
  test("navigates to a URL", async () => {
    const navigated = await executeTool(browserAutomationTool, {
      action: "navigate",
      url: "https://example.com",
    });
    expect(navigated.success).toBe(true);
    expect(navigated.data?.["provider"]).toBe("pinchtab");
    expect(navigated.data?.["url"]).toBe("https://example.com");
  });

  test("reads page text", async () => {
    await executeTool(browserAutomationTool, {
      action: "navigate",
      url: "https://example.com",
    });
    const text = await executeTool(browserAutomationTool, {
      action: "get-text",
      selector: "h1",
    });
    expect(text.success).toBe(true);
    expect(stringField(text.data, "text")).toContain("Example Domain");
  });

  test("captures a screenshot", async () => {
    await executeTool(browserAutomationTool, {
      action: "navigate",
      url: "https://example.com",
    });
    const filename = `test-e2e-screenshot-${crypto.randomUUID()}.png`;
    const result = await executeTool(browserAutomationTool, {
      action: "screenshot",
      filename,
    });
    const screenshotPath = stringField(result.data, "path");
    try {
      expect(result.success).toBe(true);
      expect(await Bun.file(screenshotPath).bytes()).toEqual(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
    } finally {
      await rm(screenshotPath, { force: true });
    }
  });

  test("reports page-action failures", async () => {
    await executeTool(browserAutomationTool, {
      action: "navigate",
      url: "https://example.com",
    });
    const result = await executeTool(browserAutomationTool, {
      action: "type",
      selector: "input[name='q']",
      text: "test search",
      timeout: 1000,
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain("failed with HTTP 422");
  });

  test("closes the browser session", async () => {
    await executeTool(browserAutomationTool, {
      action: "navigate",
      url: "https://example.com",
    });
    const result = await executeTool(browserAutomationTool, {
      action: "close",
    });
    expect(result).toMatchObject({
      success: true,
      message: "PinchTab tab closed",
    });
  });
});
