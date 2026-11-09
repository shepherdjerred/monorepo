import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod/v4";
import { localPromotionStore } from "./local-store.ts";
import { executeLocalPromotion } from "./local-execution.ts";
import { reserveLocalAi } from "./local-budget.ts";
import { promotionSpendDay } from "#activities/promotion/control/budget.ts";
import { memoryPromotionStore } from "#activities/promotion/test-support.ts";
import { localActivityEnvironment } from "./local-agent.ts";
import { Context } from "@temporalio/activity";
import {
  readPromotionState,
  updatePromotionState,
} from "#activities/promotion/store.ts";
import { promotionTarget } from "#activities/promotion/manifest.ts";

it("supplies the actual dev activity namespace to the shared executor", async () => {
  const environment = localActivityEnvironment("pmc", "fixture");
  expect(
    await environment.run(() =>
      Promise.resolve(Context.current().info.namespace),
    ),
  ).toBe("dev");
});
describe("durable local promotion", () => {
  it("runs the status CLI without credentials or a Temporal server", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "promotion-cli-"));
    try {
      const child = Bun.spawn(
        [
          process.execPath,
          path.join(import.meta.dir, "local.ts"),
          "status",
          "--all",
          "--json",
          "--state-dir",
          directory,
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
      const rows = z
        .array(z.object({ targetId: z.string(), status: z.string() }))
        .parse(JSON.parse(stdout));
      expect(
        rows.find((row) => row.targetId === "realm-explorer")?.status,
      ).toBe("blocked");
      expect(
        rows.find((row) => row.targetId === "discord-lfg-fast")?.status,
      ).toBe("idle");
    } finally {
      await rm(directory, { recursive: true });
    }
  });
  it("persists conditional writes and rejects stale updates from another connection", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "promotion-store-"));
    const first = await localPromotionStore(directory);
    const second = await localPromotionStore(directory);
    try {
      expect(await first.store.put("key", { count: 1 }, undefined)).toBe(true);
      const row = await second.store.read(
        "key",
        z.object({ count: z.number() }),
      );
      expect(await first.store.put("key", { count: 2 }, row?.etag)).toBe(true);
      expect(await second.store.put("key", { count: 3 }, row?.etag)).toBe(
        false,
      );
      const updated = await second.store.read(
        "key",
        z.object({ count: z.number() }),
      );
      expect(updated?.value).toEqual({ count: 2 });
    } finally {
      first.close();
      second.close();
    }
    const reopened = await localPromotionStore(directory);
    try {
      const row = await reopened.store.read(
        "key",
        z.object({ count: z.number() }),
      );
      expect(row?.value.count).toBe(2);
    } finally {
      reopened.close();
      await rm(directory, { recursive: true });
    }
  });
  it("retains ambiguous effects and blocks a second live execution", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "promotion-effects-"));
    const database = await localPromotionStore(directory);
    const target = promotionTarget("pmc");
    try {
      await expect(
        executeLocalPromotion({
          target,
          mode: "run",
          store: database.store,
          execute: async ({ occurrenceId }) => {
            await updatePromotionState(database.store, target.id, (state) => ({
              ...state,
              attempts: [
                {
                  occurrenceId,
                  attemptedAt: new Date().toISOString(),
                  settledAt: null,
                  status: "uncertain",
                  receiptUrl: null,
                  evidenceKey: null,
                  contentHash: "fixture",
                  beforeSubmission: [],
                },
              ],
            }));
            throw new Error("Lost response after submission");
          },
        }),
      ).rejects.toThrow("Lost response");
      const pending = await readPromotionState(database.store, target.id);
      expect(pending.lock).not.toBeNull();
      let executed = false;
      await expect(
        executeLocalPromotion({
          target,
          mode: "run",
          store: database.store,
          execute: async () => {
            executed = true;
          },
        }),
      ).rejects.toThrow("outstanding owner");
      expect(executed).toBe(false);
    } finally {
      database.close();
      await rm(directory, { recursive: true });
    }
  });
  it("preview releases ownership without inventing a posting attempt; pause blocks run", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "promotion-preview-"));
    const database = await localPromotionStore(directory);
    const target = promotionTarget("pmc");
    try {
      await executeLocalPromotion({
        target,
        mode: "preview",
        store: database.store,
        execute: () => Promise.resolve("prepared"),
      });
      const state = await readPromotionState(database.store, target.id);
      expect(state.lock).toBeNull();
      expect(state.attempts).toEqual([]);
      await updatePromotionState(database.store, target.id, (current) => ({
        ...current,
        paused: true,
      }));
      await expect(
        executeLocalPromotion({
          target,
          mode: "run",
          store: database.store,
          execute: () => Promise.resolve(),
        }),
      ).rejects.toThrow("paused");
    } finally {
      database.close();
      await rm(directory, { recursive: true });
    }
  });
});
describe("daily local spend", () => {
  it("uses Los Angeles calendar days", () => {
    expect(promotionSpendDay(new Date("2026-11-07T07:59:59Z"))).toBe(
      "2026-11-06",
    );
    expect(promotionSpendDay(new Date("2026-11-07T08:00:00Z"))).toBe(
      "2026-11-07",
    );
  });
  it("includes today's CAPTCHA charges but does not carry yesterday into the daily stop", async () => {
    const store = memoryPromotionStore();
    const key = `solver/${new Date().toISOString().slice(0, 7)}.json`;
    const charge = {
      occurrenceId: "captcha-fixture",
      taskId: 1,
      createdAt: new Date().toISOString(),
      reservedMicrousd: 5_000_000,
      chargedMicrousd: 5_000_000,
    };
    await store.put(
      key,
      { version: 1, charges: { fixture: charge } },
      undefined,
    );
    await expect(
      reserveLocalAi(store, "today", {
        model: "gpt-5.6-luna",
        dailySpendUsd: 5,
      }),
    ).rejects.toThrow("Daily promotion spend limit");
    const current = await store.read(key, z.unknown());
    await store.put(
      key,
      {
        version: 1,
        charges: {
          fixture: {
            ...charge,
            createdAt: new Date(Date.now() - 86_400_000).toISOString(),
          },
        },
      },
      current?.etag,
    );
    await expect(
      reserveLocalAi(store, "next-day", {
        model: "gpt-5.6-luna",
        dailySpendUsd: 5,
      }),
    ).resolves.toBeTypeOf("function");
  });
  it("persists daily reported spend without charging hypothetical reservations", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "promotion-budget-"));
    const database = await localPromotionStore(directory);
    try {
      await expect(
        reserveLocalAi(database.store, "too-expensive", {
          model: "gpt-5.6-luna",
          dailySpendUsd: 0,
        }),
      ).rejects.toThrow("limit");
      const settle = await reserveLocalAi(database.store, "one", {
        model: "gpt-5.6-luna",
        dailySpendUsd: 5,
      });
      await settle({
        inputTokens: 1000,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
        outputTokens: 10,
        reasoningTokens: 0,
      });
      const cancelBeforeGeneration = await reserveLocalAi(
        database.store,
        "two",
        {
          model: "gpt-5.6-luna",
          dailySpendUsd: 5,
        },
      );
      await cancelBeforeGeneration({
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
      });
    } finally {
      database.close();
    }
    const reopened = await localPromotionStore(directory);
    try {
      const settle = await reserveLocalAi(reopened.store, "three", {
        model: "gpt-5.6-luna",
        dailySpendUsd: 5,
      });
      await settle({
        inputTokens: 25_000_000,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
      });
      await expect(
        reserveLocalAi(reopened.store, "four", {
          model: "gpt-5.6-luna",
          dailySpendUsd: 5,
        }),
      ).rejects.toThrow("Daily promotion spend limit");
    } finally {
      reopened.close();
      await rm(directory, { recursive: true });
    }
  });
});
