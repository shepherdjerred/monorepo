export type ToolCallRecord = Readonly<{
  method: string;
  path: string;
  status: number;
  at: number;
}>;

const CAPACITY = 100;
const SUMMARY_TOP_PATHS = 4;

/**
 * In-memory record of what a goal run has been doing, fed by the control
 * server's tool-call log and the codex agent_message stream. Clock-free:
 * callers stamp `at` so the class stays deterministic in tests. Backs the
 * interval status updates posted to Discord.
 */
export class GoalActivityLog {
  private readonly calls: ToolCallRecord[] = [];
  private latestAgentMessage: string | undefined;

  record(entry: ToolCallRecord): void {
    this.calls.push(entry);
    if (this.calls.length > CAPACITY) {
      this.calls.splice(0, this.calls.length - CAPACITY);
    }
  }

  noteAgentMessage(text: string): void {
    const trimmed = text.trim();
    if (trimmed.length > 0) {
      this.latestAgentMessage = trimmed;
    }
  }

  lastAgentMessage(): string | undefined {
    return this.latestAgentMessage;
  }

  /**
   * Compact summary of tool calls at or after `since`, e.g.
   * "14 actions (8 /move, 3 /observe, 2 /battle/move, 1 err)".
   * Undefined when no calls landed in the window. May undercount when more
   * than the ring capacity landed inside the window.
   */
  summarizeSince(since: number): string | undefined {
    const window = this.calls.filter((call) => call.at >= since);
    if (window.length === 0) {
      return undefined;
    }
    const byPath = new Map<string, number>();
    let errors = 0;
    for (const call of window) {
      byPath.set(call.path, (byPath.get(call.path) ?? 0) + 1);
      if (call.status >= 400) {
        errors++;
      }
    }
    const top = [...byPath.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, SUMMARY_TOP_PATHS)
      .map(([path, count]) => `${String(count)} ${path}`);
    if (byPath.size > SUMMARY_TOP_PATHS) {
      top.push("…");
    }
    if (errors > 0) {
      top.push(`${String(errors)} err`);
    }
    const noun = window.length === 1 ? "action" : "actions";
    return `${String(window.length)} ${noun} (${top.join(", ")})`;
  }
}
