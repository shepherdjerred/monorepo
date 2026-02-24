import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type {
  ConversationEntry,
  SessionSummary,
} from "@shepherdjerred/sentinel/types/history.ts";

const MAX_CONTENT_LENGTH = 100_000;

export class ConversationLogger {
  readonly filePath: string;
  private initialized = false;

  constructor(
    private readonly agent: string,
    private readonly jobId: string,
    private readonly sessionId: string,
    dataDir: string,
  ) {
    const timestamp = new Date().toISOString().replaceAll(":", "-");
    const dir = path.join(dataDir, "conversations", agent);
    this.filePath = path.join(dir, `${timestamp}_${sessionId}.jsonl`);
  }

  async appendEntry(entry: ConversationEntry): Promise<void> {
    if (!this.initialized) {
      const dir = path.join(this.filePath, "..");
      await mkdir(dir, { recursive: true });
      this.initialized = true;
    }

    let { content } = entry;
    if (content.length > MAX_CONTENT_LENGTH) {
      const originalLength = content.length;
      content =
        content.slice(0, MAX_CONTENT_LENGTH) +
        `[truncated, original size: ${String(originalLength)}]`;
    }

    const line = JSON.stringify({ ...entry, content }) + "\n";
    await appendFile(this.filePath, line);
  }

  async writeSummary(summary: SessionSummary): Promise<void> {
    const entry: ConversationEntry = {
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      agent: this.agent,
      jobId: this.jobId,
      role: "system",
      content: JSON.stringify(summary),
      turnNumber: 0,
      metadata: { type: "summary" },
    };
    await this.appendEntry(entry);
  }

  getFilePath(): string {
    return this.filePath;
  }
}

export function createConversationLogger(
  agent: string,
  jobId: string,
  sessionId: string,
  dataDir = "data",
): ConversationLogger {
  return new ConversationLogger(agent, jobId, sessionId, dataDir);
}
