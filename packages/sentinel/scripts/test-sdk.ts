#!/usr/bin/env bun
/**
 * Minimal test script to verify Claude Agent SDK works.
 * Requires ANTHROPIC_API_KEY to be set (either directly or via `op run`).
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... bun run scripts/test-sdk.ts
 *   op run -- bun run scripts/test-sdk.ts
 */
import { query } from "@anthropic-ai/claude-agent-sdk";

const CLAUDE_SESSION_VARS = new Set([
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS",
]);

function buildCleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(Bun.env)) {
    if (
      value != null &&
      !CLAUDE_SESSION_VARS.has(key) &&
      !value.startsWith("op://")
    ) {
      env[key] = value;
    }
  }
  return env;
}

const apiKey = Bun.env["ANTHROPIC_API_KEY"];

if (apiKey == null || apiKey.startsWith("op://")) {
  console.error("ANTHROPIC_API_KEY not set or unresolved op:// reference.");
  console.error(
    "Run with: ANTHROPIC_API_KEY=sk-ant-... bun run scripts/test-sdk.ts",
  );
  console.error("Or:       op run -- bun run scripts/test-sdk.ts");
  process.exit(1);
}

console.log("Starting SDK test...");
console.log("Key prefix:", apiKey.slice(0, 10));

const cleanEnv = buildCleanEnv();
console.log("CLAUDECODE stripped:", cleanEnv["CLAUDECODE"] === undefined);

try {
  const agentQuery = query({
    prompt: "Say hello in exactly 5 words.",
    options: {
      model: "claude-sonnet-4-6",
      systemPrompt: "You are a helpful assistant. Be brief.",
      maxTurns: 1,
      allowedTools: [],
      permissionMode: "dontAsk",
      cwd: process.cwd(),
      env: cleanEnv,
      stderr: (data: string) => {
        console.error("[SDK stderr]", data.trim());
      },
    },
  });

  for await (const message of agentQuery) {
    if (message.type === "system" && message.subtype === "init") {
      console.log(
        "[init] model:",
        message.model,
        "tools:",
        message.tools.length,
      );
    } else if (message.type === "assistant") {
      const text = message.message.content
        .filter((b: { type: string }) => b.type === "text")
        .map((b: { text?: string }) => b.text ?? "")
        .join("");
      console.log("[assistant]", text);
    } else if (message.type === "result") {
      if (message.subtype === "success") {
        console.log("\nResult:", message.result);
        console.log("Cost: $" + message.total_cost_usd.toFixed(4));
      } else {
        console.log("\nErrors:", message.errors);
      }
    }
  }

  console.log("\nSDK test completed successfully!");
} catch (error) {
  console.error("SDK test failed:", error);
  process.exit(1);
}
