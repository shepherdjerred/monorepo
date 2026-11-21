import { expect, test } from "vitest";
import { imageSmokeCommand } from "./smoke-app-in-image.ts";

const repoRoot = new URL("../../..", import.meta.url).pathname;

test("the streambot image smoke environment satisfies the usage analytics startup guard", async () => {
  const env = imageSmokeCommand("streambot").env;
  const child = Bun.spawn(
    [
      "bun",
      "-e",
      [
        'import { loadConfig } from "./packages/streambot/src/config/index.ts";',
        'import { usageAnalyticsTransport } from "./packages/streambot/src/observability/product-analytics.ts";',
        "const env = JSON.parse(await new Response(Bun.stdin).text());",
        "const config = loadConfig(env);",
        "if (config.analytics.enabled !== false || config.analytics.posthog !== undefined) {",
        '  throw new Error("smoke env left usage analytics on or attached a destination");',
        "}",
        "usageAnalyticsTransport(config.analytics);",
        "const bare = loadConfig({",
        '  BOT_TOKEN: "fixture",',
        '  USER_TOKENS: "fixture",',
        '  VIDEOS_DIR: "/videos",',
        "});",
        "let refused = false;",
        "try {",
        "  usageAnalyticsTransport(bare.analytics);",
        "} catch (error) {",
        '  refused = error instanceof Error && error.message.includes("POSTHOG_PROJECT_TOKEN");',
        "}",
        'if (!refused) throw new Error("default-on startup did not refuse a missing PostHog destination");',
        "console.log(JSON.stringify({ enabled: config.analytics.enabled }));",
      ].join("\n"),
    ],
    {
      cwd: repoRoot,
      stdin: Response.json(env),
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(exitCode, `${stdout}\n${stderr}`).toBe(0);
  expect(JSON.parse(stdout)).toEqual({ enabled: false });
});
