import { mkdir } from "node:fs/promises";
import path from "node:path";
import { writeDatabase } from "./database.ts";

// Minimal protobuf encoder matching the wire format
// packages/toolkit/src/lib/history/antigravity/protobuf.ts decodes.
function encodeVarint(value: number, out: number[]): void {
  let remaining = value;
  while (remaining >= 0x80) {
    out.push((remaining & 0x7f) | 0x80);
    remaining = Math.floor(remaining / 128);
  }
  out.push(remaining);
}

function encodeBytesField(
  fieldNumber: number,
  bytes: readonly number[],
  out: number[],
): void {
  encodeVarint((fieldNumber << 3) | 2, out);
  encodeVarint(bytes.length, out);
  out.push(...bytes);
}

function encodeVarintField(
  fieldNumber: number,
  value: number,
  out: number[],
): void {
  encodeVarint(fieldNumber << 3, out);
  encodeVarint(value, out);
}

function encodeModelUsage(usage: {
  readonly inputTokens: number;
  readonly totalOutputTokens: number;
  readonly cacheReadTokens?: number;
  readonly cacheCreationTokens?: number;
  readonly reasoningTokens?: number;
  readonly visibleOutputTokens?: number;
}): number[] {
  const out: number[] = [];
  encodeVarintField(2, usage.inputTokens, out);
  encodeVarintField(3, usage.totalOutputTokens, out);
  if (usage.cacheCreationTokens !== undefined) {
    encodeVarintField(4, usage.cacheCreationTokens, out);
  }
  if (usage.cacheReadTokens !== undefined) {
    encodeVarintField(5, usage.cacheReadTokens, out);
  }
  if (usage.reasoningTokens !== undefined) {
    encodeVarintField(9, usage.reasoningTokens, out);
  }
  if (usage.visibleOutputTokens !== undefined) {
    encodeVarintField(10, usage.visibleOutputTokens, out);
  }
  return out;
}

export async function writeAntigravityFixture(
  antigravityRoot: string,
): Promise<void> {
  const conversationsDir = path.join(antigravityRoot, "conversations");
  await mkdir(conversationsDir, { recursive: true });
  const dbFile = path.join(conversationsDir, "antigravity-session-1.db");
  writeDatabase(
    dbFile,
    "CREATE TABLE steps (idx INTEGER, metadata BLOB);",
    (database) => {
      const usage = encodeModelUsage({
        inputTokens: 500,
        totalOutputTokens: 80,
        cacheReadTokens: 200,
      });
      const modelInfo: number[] = [];
      encodeBytesField(
        12,
        [...new TextEncoder().encode("claude-sonnet-5")],
        modelInfo,
      );
      const metadata: number[] = [];
      encodeBytesField(9, usage, metadata);
      encodeBytesField(24, modelInfo, metadata);
      database
        .prepare("INSERT INTO steps VALUES (1, ?)")
        .run(new Uint8Array(metadata));

      // A reasoning-heavy generation: Gemini reports visible output and
      // reasoning as separate additive fields (no `totalOutputTokens`), so
      // this proves billed output includes reasoning rather than dropping it.
      const reasoningUsage = encodeModelUsage({
        inputTokens: 10,
        totalOutputTokens: 0,
        visibleOutputTokens: 30,
        reasoningTokens: 50,
      });
      const reasoningModelInfo: number[] = [];
      encodeBytesField(
        12,
        [...new TextEncoder().encode("claude-sonnet-5")],
        reasoningModelInfo,
      );
      const reasoningMetadata: number[] = [];
      encodeBytesField(9, reasoningUsage, reasoningMetadata);
      encodeBytesField(24, reasoningModelInfo, reasoningMetadata);
      database
        .prepare("INSERT INTO steps VALUES (2, ?)")
        .run(new Uint8Array(reasoningMetadata));
    },
  );
}
