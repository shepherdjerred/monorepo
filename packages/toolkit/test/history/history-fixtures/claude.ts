import path from "node:path";

export async function writeClaudeFixture(claudeDir: string): Promise<void> {
  const claudeFile = path.join(claudeDir, "session.jsonl");
  // Claude Code can log one API response's content blocks as separate
  // records sharing one message.id, each repeating that response's usage
  // snapshot as of that point — a growing cumulative total, not a fixed
  // repeat. The LAST record's (larger) usage is the authoritative total.
  const partialUsage = {
    input_tokens: 1000,
    output_tokens: 50,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };
  const finalUsage = {
    input_tokens: 1000,
    output_tokens: 200,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };
  await Bun.write(
    claudeFile,
    `${JSON.stringify({ type: "user", sessionId: "claude-session", timestamp: "2026-08-12T00:00:00Z", message: { role: "user", content: "Investigate database migration" } })}\n${JSON.stringify(
      {
        type: "assistant",
        sessionId: "claude-session",
        timestamp: "2026-08-12T00:01:00Z",
        message: {
          id: "msg_claude-usage-dedup-marker",
          role: "assistant",
          model: "claude-sonnet-5",
          usage: partialUsage,
          content: [
            { type: "text", text: "Migration is complete" },
            { type: "thinking", thinking: "omit-claude-reasoning" },
          ],
        },
      },
    )}\n${JSON.stringify(
      // Same API response as the record above (shared message.id), split
      // into a second JSONL line carrying the tool_use block plus the
      // final, larger usage snapshot — this must replace the partial
      // snapshot above rather than being summed with it or dropped.
      {
        type: "assistant",
        sessionId: "claude-session",
        timestamp: "2026-08-12T00:01:00Z",
        message: {
          id: "msg_claude-usage-dedup-marker",
          role: "assistant",
          model: "claude-sonnet-5",
          usage: finalUsage,
          content: [
            {
              type: "tool_use",
              name: "shell",
              input: { command: "bun test migration" },
            },
          ],
        },
      },
    )}\n${JSON.stringify({ type: "system", timestamp: "2026-08-12T00:02:00Z", content: "omit-claude-system" })}\n`,
  );
}
