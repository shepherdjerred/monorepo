import { expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { localPromotionStore } from "./local-store.ts";
import { prepareProductionHandoff } from "./production-handoff.ts";
import { updatePromotionState } from "#activities/promotion/store.ts";
import { PromotionStateSchema } from "#shared/promotion/model.ts";

it("refuses handoff while a local executor still owns the session", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "promotion-live-owner-"));
  const database = await localPromotionStore(directory);
  try {
    await database.store.put(
      "local/session.json",
      { pid: process.pid, acquiredAt: new Date().toISOString() },
      undefined,
    );
    await expect(prepareProductionHandoff(directory)).rejects.toThrow(
      "Local executor must stop",
    );
  } finally {
    database.close();
    await rm(directory, { recursive: true });
  }
});

it("prepares an immutable handoff preserving pauses, cooldowns and unresolved effects", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "promotion-handoff-"));
  const database = await localPromotionStore(directory);
  try {
    const evidence = path.join(directory, "receipt.json");
    await Bun.write(evidence, JSON.stringify({ fixture: true }));
    await updatePromotionState(database.store, "pmc", (state) => ({
      ...state,
      paused: true,
      nextEligibleAt: "2030-01-01T00:00:00Z",
      lock: {
        occurrenceId: `local/${String(process.pid)}/pmc/old`,
        acquiredAt: "2000-01-01T00:00:00Z",
      },
      attempts: [
        {
          occurrenceId: "original",
          attemptedAt: "2026-11-01T00:00:00Z",
          settledAt: null,
          status: "uncertain",
          receiptUrl: null,
          evidenceKey: evidence,
          contentHash: "fixture",
          beforeSubmission: [],
        },
      ],
    }));
    const read = new Database(path.join(directory, "promotion.sqlite"), {
      readonly: true,
    });
    try {
      const before = read.query("SELECT * FROM objects ORDER BY key").all();
      const plan = await prepareProductionHandoff(directory);
      expect(read.query("SELECT * FROM objects ORDER BY key").all()).toEqual(
        before,
      );
      const state = PromotionStateSchema.parse(
        plan.objects.get("targets/pmc.json"),
      );
      expect(state).toMatchObject({
        paused: true,
        lock: null,
        nextEligibleAt: "2030-01-01T00:00:00Z",
      });
      expect(state.attempts[0]).toMatchObject({
        status: "uncertain",
        occurrenceId: "original",
        settledAt: null,
      });
      expect(state.attempts[0]?.evidenceKey).toContain(
        "storm/promotion/v1/prod/evidence/imports/",
      );
      expect(plan.artifacts.size).toBe(1);
    } finally {
      read.close();
    }
  } finally {
    database.close();
    await rm(directory, { recursive: true });
  }
});
