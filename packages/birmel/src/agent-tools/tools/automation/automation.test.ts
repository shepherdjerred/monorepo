import { beforeAll, describe, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { runWithRequestContext } from "@shepherdjerred/birmel/agent-tools/tools/request-context.ts";
import { getConfig, resetConfig } from "@shepherdjerred/birmel/config/index.ts";
import { browserAutomationTool } from "./browser.ts";
import {
  RunCodeRequestSchema,
  SANDBOX_MAX_SOURCE_BYTES,
} from "@shepherdjerred/birmel/sandbox/contracts.ts";
import { BrowserInputSchema } from "./browser-types.ts";

beforeAll(() => {
  Bun.env["DISCORD_CLIENT_ID"] = "123456789012345678";
  resetConfig();
});

const ToolResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  effectDisposition: z.literal("not_applied").optional(),
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
      ownsSourceReply: true,
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

describe("code sandbox contract", () => {
  test("accepts only bounded Python, JavaScript, and TypeScript snippets", () => {
    for (const language of ["python", "javascript", "typescript"] as const) {
      expect(
        RunCodeRequestSchema.safeParse({ language, source: "print(1)" })
          .success,
      ).toBe(true);
    }
    expect(
      RunCodeRequestSchema.safeParse({ language: "shell", source: "id" })
        .success,
    ).toBe(false);
    expect(
      RunCodeRequestSchema.safeParse({
        language: "python",
        source: "x".repeat(SANDBOX_MAX_SOURCE_BYTES + 1),
      }).success,
    ).toBe(false);
  });
});

describe("PinchTab HTTP boundary", () => {
  test("does not expose cookie, profile, instance, or filename controls", () => {
    expect(BrowserInputSchema.safeParse({ action: "cookies" }).success).toBe(
      false,
    );
    for (const input of [
      { action: "navigate", url: "https://example.com", profile: "other" },
      {
        action: "navigate",
        url: "https://example.com",
        instanceId: "other",
      },
      { action: "screenshot", filename: "../../secret" },
    ]) {
      expect(BrowserInputSchema.safeParse(input).success).toBe(false);
    }
  });

  test("navigates to a URL", async () => {
    const navigated = await executeTool(browserAutomationTool, {
      action: "navigate",
      url: "https://example.com",
    });
    expect(navigated.success).toBe(true);
    expect(navigated.data?.["provider"]).toBe("pinchtab");
    expect(navigated.data?.["url"]).toBe("https://example.com");
  });

  test("rehydrates a persisted tab before a durable action", async () => {
    const navigated = await executeTool(browserAutomationTool, {
      action: "navigate",
      tabId: "tab-persisted",
      url: "https://example.com/persisted",
    });
    expect(navigated).toMatchObject({
      success: true,
      data: {
        provider: "pinchtab",
        tabId: "tab-persisted",
        url: "https://example.com/persisted",
      },
    });
  });

  test("restarts the configured profile when its cached instance disappears", async () => {
    const opened = await executeTool(browserAutomationTool, {
      action: "open",
      url: "https://example.com/restart-pinchtab",
    });
    expect(opened).toMatchObject({
      success: true,
      data: {
        provider: "pinchtab",
        url: "https://example.com/restart-pinchtab",
      },
    });
    expect(stringField(opened.data, "tabId")).toMatch(
      /^tab-instance-test-profile-\d+$/,
    );
  });

  test("reopens a validated URL when a cached tab disappears", async () => {
    const initial = await executeTool(browserAutomationTool, {
      action: "open",
      url: "https://example.com/initial-tab",
    });
    const navigated = await executeTool(browserAutomationTool, {
      action: "navigate",
      tabId: stringField(initial.data, "tabId"),
      url: "https://example.com/stale-pinchtab-tab",
    });
    expect(navigated).toMatchObject({
      success: true,
      message: "Browser tab opened",
      data: {
        provider: "pinchtab",
        url: "https://example.com/stale-pinchtab-tab",
      },
    });
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
    const result = await executeTool(browserAutomationTool, {
      action: "screenshot",
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

  test.each([
    { action: "get-text" },
    { action: "snapshot" },
    { action: "screenshot" },
    { action: "click", selector: "h1" },
    { action: "type", selector: "input", text: "query" },
    { action: "press", key: "Enter" },
    { action: "close" },
  ])("evicts a stale tab when $action returns 404", async (input) => {
    const result = await executeTool(browserAutomationTool, {
      ...input,
      tabId: "tab-stale-direct",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("failed with HTTP 404");
    expect(result.effectDisposition).toBe("not_applied");
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
      message: "Browser tab closed",
    });
  });
});
