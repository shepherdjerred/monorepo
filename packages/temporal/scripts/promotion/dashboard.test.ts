import { it, expect } from "vitest";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { localPromotionStore } from "./local-store.ts";
import { createLocalJournal } from "./local-journal.ts";
import { readDashboard, receiptFile } from "./dashboard-data.ts";
import { dashboardFetch } from "./dashboard-api.ts";
import { updatePromotionState } from "#activities/promotion/store.ts";

async function fixture(
  test: (
    dir: string,
    store: Awaited<ReturnType<typeof localPromotionStore>>["store"],
  ) => Promise<void>,
) {
  const dir = await mkdtemp(path.join(tmpdir(), "promotion-dashboard-"));
  const database = await localPromotionStore(dir);
  try {
    await test(dir, database.store);
  } finally {
    database.close();
    await rm(dir, { recursive: true });
  }
}
it("reads legacy previews separately from confirmed actions without changing stored state", async () =>
  fixture(async (dir, store) => {
    await updatePromotionState(store, "pmc", (state) => ({
      ...state,
      attempts: [
        {
          occurrenceId: "manual/pmc",
          attemptedAt: "2026-11-01T00:00:00Z",
          settledAt: "2026-11-01T00:00:01Z",
          status: "verified",
          receiptUrl:
            "https://www.planetminecraft.com/server/the-storm-3004178/",
          evidenceKey: null,
          contentHash: "fixture",
          beforeSubmission: [],
        },
      ],
    }));
    await mkdir(path.join(dir, "runs", "legacy"), { recursive: true });
    await Bun.write(
      path.join(dir, "runs", "legacy", "summary.json"),
      JSON.stringify([
        {
          targetId: "pmc",
          result: {
            status: "preview",
            summary: "Bump prepared",
            receipt: null,
          },
        },
      ]),
    );
    const db = new Database(path.join(dir, "promotion.sqlite"), {
      readonly: true,
    });
    try {
      const before = db.query("SELECT * FROM objects ORDER BY key").all();
      const data = await readDashboard(dir);
      expect(data.overview.sources).toHaveLength(38);
      const source = data.overview.sources.find((s) => s.id === "pmc");
      expect(source?.preview?.status).toBe("preview");
      expect(source?.latest?.timeBasis).toBe("report-saved");
      expect(source?.lastAction?.occurrenceId).toBe("manual/pmc");
      expect(db.query("SELECT * FROM objects ORDER BY key").all()).toEqual(
        before,
      );
    } finally {
      db.close();
    }
  }));
it("records simulated queued, running, skipped and finished progress without agents", async () =>
  fixture(async (dir, store) => {
    const journal = await createLocalJournal(store, "simulation", "preview", {
      targetIds: ["pmc", "reddit-mcservers"],
      scope: "selected",
    });
    const queued = await readDashboard(dir);
    expect(queued.overview.batches[0]?.entries[0]?.status).toBe("queued");
    await journal.update("pmc", {
      status: "running",
      phase: "Verifying result",
      startedAt: new Date().toISOString(),
    });
    const running = await readDashboard(dir);
    expect(running.overview.batches[0]?.entries[0]?.phase).toBe(
      "Verifying result",
    );
    await journal.update("pmc", { status: "completed", summary: "Ready" });
    await journal.update("reddit-mcservers", {
      status: "skipped",
      phase: "cooldown",
      summary: "Cooldown",
    });
    await journal.finish();
    const finished = await readDashboard(dir);
    expect(finished.overview.batches[0]?.finishedAt).not.toBeNull();
    expect(finished.history).toHaveLength(2);
  }));
it("preserves uncertain effects and reports cleanup failure independently", async () =>
  fixture(async (dir, store) => {
    await updatePromotionState(store, "pmc", (state) => ({
      ...state,
      paused: true,
      attempts: [
        {
          occurrenceId: "uncertain",
          attemptedAt: "2026-11-01T00:00:00Z",
          settledAt: null,
          status: "uncertain",
          receiptUrl: null,
          evidenceKey: null,
          contentHash: "fixture",
          beforeSubmission: [],
        },
      ],
    }));
    await mkdir(path.join(dir, "runs", "cleanup"), { recursive: true });
    await Bun.write(
      path.join(dir, "runs", "cleanup", "summary.json"),
      JSON.stringify([
        {
          targetId: "disboard-native-bump",
          result: {
            status: "verified",
            summary: "Bump done",
            receipt: { url: "https://discord.com/channels/1/2/3" },
          },
          cleanup: { status: "blocked", summary: "Missing permission" },
        },
      ]),
    );
    const data = await readDashboard(dir);
    expect(data.overview.sources.find((s) => s.id === "pmc")?.constraint).toBe(
      "Needs reconciliation",
    );
    const row = data.history.find((r) => r.batchId === "cleanup");
    expect(row?.status).toBe("verified");
    expect(row?.cleanup).toContain("blocked");
  }));
it("rejects writes, foreign hosts, invalid cursors and escaping evidence", async () =>
  fixture(async (dir) => {
    const serve = dashboardFetch(dir);
    const write = await serve(
      new Request("http://127.0.0.1/api/v1/promotion", { method: "POST" }),
    );
    expect(write.status).toBe(405);
    const foreign = await serve(
      new Request("http://evil.example/api/v1/promotion"),
    );
    expect(foreign.status).toBe(403);
    const cursor = await serve(
      new Request("http://127.0.0.1/api/v1/promotion/history?cursor=unknown"),
    );
    expect(cursor.status).toBe(400);
    const outside = path.join(dir, "..", path.basename(dir) + "-outside.json");
    await Bun.write(outside, "{}");
    try {
      await symlink(outside, path.join(dir, "escape.json"));
      await expect(
        receiptFile(dir, path.join(dir, "escape.json")),
      ).rejects.toThrow("outside");
    } finally {
      await rm(outside);
    }
  }));
it("reports unavailable storage without initializing it", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "promotion-missing-"));
  try {
    const response = await dashboardFetch(dir)(
      new Request("http://127.0.0.1/api/v1/promotion"),
    );
    expect(response.status).toBe(503);
    expect(await Bun.file(path.join(dir, "promotion.sqlite")).exists()).toBe(
      false,
    );
  } finally {
    await rm(dir, { recursive: true });
  }
});
