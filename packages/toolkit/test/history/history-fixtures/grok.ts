import { mkdir } from "node:fs/promises";
import path from "node:path";

export async function writeGrokFixture(grokHome: string): Promise<void> {
  const sessionDir = path.join(
    grokHome,
    "sessions",
    "%2Ftest%2Fproject",
    "grok-session-1",
  );
  await mkdir(sessionDir, { recursive: true });
  const lines = [
    {
      timestamp: 1_788_721_616,
      params: {
        sessionId: "grok-session-1",
        update: {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "Investigate flaky test" },
        },
      },
    },
    {
      timestamp: 1_788_721_618,
      params: {
        sessionId: "grok-session-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: "Found the race condition grok-tail-search-marker",
          },
        },
      },
    },
    {
      timestamp: 1_788_721_640,
      params: {
        sessionId: "grok-session-1",
        update: {
          sessionUpdate: "tool_call",
          title: "run shell command",
          status: "completed",
          // rawInput is never indexed (a command string can embed a
          // credential in forms no fixed pattern set can fully enumerate),
          // so none of this — including grok-tool-command-marker — should
          // reach toolOutputText.
          rawInput: {
            command: `curl grok-tool-command-marker -H 'Authorization: Bearer test-bearer-token-fixture-marker'`, // gitleaks:allow
            env: { API_KEY: "sk-should-not-appear-in-index" },
            password: "sk-should-not-appear-in-index",
          },
        },
      },
    },
    {
      timestamp: 1_788_721_656,
      params: {
        sessionId: "grok-session-1",
        update: {
          sessionUpdate: "turn_completed",
          usage: {
            inputTokens: 100,
            outputTokens: 20,
            cachedReadTokens: 40,
            reasoningTokens: 10,
            costUsdTicks: 18_519_200,
            modelUsage: {
              "grok-4.5-build": {
                inputTokens: 100,
                outputTokens: 20,
                cachedReadTokens: 40,
                reasoningTokens: 10,
                costUsdTicks: 18_519_200,
              },
            },
          },
        },
      },
    },
  ];
  await Bun.write(
    path.join(sessionDir, "updates.jsonl"),
    lines.map((line) => JSON.stringify(line)).join("\n"),
  );
}
