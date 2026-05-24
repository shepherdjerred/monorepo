import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildTier2CheckpointBatch,
  getTier2BatchKey,
  getTier2PromptHash,
  loadTier2Checkpoint,
} from "./tier2-checkpoint.ts";

describe("loadTier2Checkpoint", () => {
  test("treats a missing checkpoint file as empty state", async () => {
    const dir = await makeTempDir();
    try {
      const store = await loadTier2Checkpoint(path.join(dir, "missing.json"));
      expect(store.size()).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("writes and loads valid checkpoint data", async () => {
    const dir = await makeTempDir();
    const checkpointPath = path.join(dir, "tier2.checkpoint.json");
    try {
      const store = await loadTier2Checkpoint(checkpointPath);
      const key = "batch-key";
      await store.set(
        key,
        buildTier2CheckpointBatch({
          transactionIds: ["txn-1"],
          model: "claude-sonnet-4-6",
          batchSize: 25,
          promptHash: getTier2PromptHash("prompt"),
          changes: [
            {
              transactionId: "txn-1",
              transactionDate: "2026-05-23",
              merchantName: "OpenAI",
              amount: -20,
              currentCategory: "Shopping",
              currentCategoryId: "cat-shopping",
              proposedCategory: "Software",
              proposedCategoryId: "cat-software",
              confidence: "high",
              type: "recategorize",
              tier: 2,
            },
          ],
          usage: { inputTokens: 100, outputTokens: 20 },
        }),
      );

      const reloaded = await loadTier2Checkpoint(checkpointPath);
      expect(reloaded.size()).toBe(1);
      expect(reloaded.get(key)?.changes[0]?.proposedCategory).toBe("Software");
      expect(reloaded.get(key)?.usage?.inputTokens).toBe(100);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("rejects malformed checkpoint data", async () => {
    const dir = await makeTempDir();
    const checkpointPath = path.join(dir, "bad.checkpoint.json");
    try {
      await Bun.write(
        checkpointPath,
        JSON.stringify({
          schemaVersion: 1,
          createdAt: "2026-05-23T00:00:00.000Z",
          updatedAt: "2026-05-23T00:00:00.000Z",
          batches: { bad: { transactionIds: [123] } },
        }),
      );

      await expect(loadTier2Checkpoint(checkpointPath)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("getTier2BatchKey", () => {
  const base = {
    prompt: "classify these transactions",
    model: "claude-sonnet-4-6",
    batchSize: 25,
    webSearchEnabled: false,
    transactionIds: ["txn-1", "txn-2"],
  };

  test("is stable for identical batch identity", () => {
    expect(getTier2BatchKey(base)).toBe(getTier2BatchKey(base));
  });

  test("changes when the prompt changes", () => {
    expect(getTier2BatchKey(base)).not.toBe(
      getTier2BatchKey({ ...base, prompt: "classify changed transactions" }),
    );
  });

  test("changes when the model changes", () => {
    expect(getTier2BatchKey(base)).not.toBe(
      getTier2BatchKey({ ...base, model: "claude-haiku-4-5-20251001" }),
    );
  });

  test("changes when transaction order changes", () => {
    expect(getTier2BatchKey(base)).not.toBe(
      getTier2BatchKey({ ...base, transactionIds: ["txn-2", "txn-1"] }),
    );
  });
});

async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "monarch-tier2-checkpoint-test-"));
}
