import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { BlockGrid } from "@shepherdjerred/mc-build/core/grid.ts";
import { compileBuild, initBuild } from "#build/commands.ts";
import { DaemonClient } from "#build/daemon-client.ts";
import { Journal, type JournalEntry } from "#build/journal.ts";
import { diffGrids, runOps } from "#build/ops.ts";
import { BuildWorkspace } from "#build/workspace.ts";
import type { WeOp } from "#protocol/bridge.ts";
import { appendOp, OpLogSchema, readOpLog, type Op } from "#protocol/build.ts";

const temp = await mkdtemp(path.join(os.tmpdir(), "mc-harness-build-"));
afterAll(async () => {
  await rm(temp, { recursive: true, force: true });
});

const COTTAGE = path.resolve(
  import.meta.dirname,
  "../../mc-build/test/fixtures/house.build.ts",
);

class FakeClient extends DaemonClient {
  calls: string[] = [];

  override we(
    id: string,
    request: { session: string; world: string; ops: WeOp[] },
  ) {
    this.calls.push(
      `we:${id}:${request.world}:${request.ops.map((op) => op.command).join("|")}`,
    );
    return Promise.resolve({
      results: request.ops.map((op) => ({
        command: op.command,
        ok: !op.command.includes("fail"),
        messages: [],
        errors: [],
      })),
      historySize: request.ops.length,
    });
  }

  override command(id: string, command: string) {
    this.calls.push(`command:${id}:${command}`);
    return Promise.resolve({ success: true, output: [] });
  }

  override paste(id: string, request: Parameters<DaemonClient["paste"]>[1]) {
    this.calls.push(
      `paste:${id}:${request.at.x.toString()},${request.at.y.toString()},${request.at.z.toString()}:${request.ignoreAir.toString()}`,
    );
    return Promise.resolve({
      changed: 1,
      min: request.at,
      max: request.at,
      historySize: 1,
    });
  }
}

const weOp = (command: string, world = "world"): Op => ({
  kind: "we",
  world,
  command,
  source: "manual",
});

describe("op log", () => {
  it("refuses to append outside a build directory", async () => {
    await expect(
      appendOp(path.join(temp, "nowhere"), weOp("//set stone")),
    ).rejects.toThrow(/not a build directory/u);
  });

  it("round-trips ops through the log file", async () => {
    const dir = path.join(temp, "log");
    await initBuild(dir, {
      name: "log",
      world: "world",
      anchor: { x: 0, y: 64, z: 0 },
      seed: 1,
    });
    expect(await appendOp(dir, weOp("//set stone"))).toBe(1);
    expect(
      await appendOp(dir, {
        kind: "command",
        command: "time set day",
        source: "manual",
      }),
    ).toBe(2);
    const log = await readOpLog(dir);
    expect(OpLogSchema.parse(log).ops.map((op) => op.kind)).toEqual([
      "we",
      "command",
    ]);
  });
});

describe("runOps", () => {
  it("batches consecutive WorldEdit ops per world and keeps order", async () => {
    const client = new FakeClient();
    const workspace = new BuildWorkspace(temp);
    await runOps(
      { client, target: "sbx-000001", workspace, session: "build-x" },
      [
        weOp("//set stone"),
        weOp("//set dirt"),
        weOp("//set sand", "world_nether"),
        { kind: "command", command: "time set day", source: "manual" },
        weOp("//set glass"),
      ],
    );
    expect(client.calls).toEqual([
      "we:sbx-000001:world://set stone|//set dirt",
      "we:sbx-000001:world_nether://set sand",
      "command:sbx-000001:time set day",
      "we:sbx-000001:world://set glass",
    ]);
  });

  it("fails loudly when a WorldEdit op reports an error", async () => {
    const client = new FakeClient();
    await expect(
      runOps(
        {
          client,
          target: "sbx-000001",
          workspace: new BuildWorkspace(temp),
          session: "s",
        },
        [weOp("//fail now")],
      ),
    ).rejects.toThrow(/WorldEdit op failed: \/\/fail now/u);
  });
});

describe("compileBuild", () => {
  it("adds program ops and replaces them on recompile", async () => {
    const dir = path.join(temp, "cottage");
    await initBuild(dir, {
      name: "cottage",
      world: "world",
      anchor: { x: 100, y: -60, z: 200 },
      seed: 42,
    });
    await Bun.write(path.join(dir, "build.ts"), Bun.file(COTTAGE));
    await appendOp(dir, weOp("//set dirt_path"));
    const first = await compileBuild(dir);
    expect(first.at).toEqual({ x: 99, y: -60, z: 199 });
    expect(first.lint.ok).toBe(true);
    const afterFirst = await readOpLog(dir);
    const programOps = afterFirst.ops.filter((op) =>
      op.source.startsWith("program:"),
    );
    expect(programOps.at(-1)?.kind).toBe("paste");
    expect(afterFirst.ops.at(0)?.source).toBe("manual");
    await compileBuild(dir);
    const afterSecond = await readOpLog(dir);
    expect(afterSecond.ops.length).toBe(afterFirst.ops.length);
    expect(afterSecond.ops.filter((op) => op.source === "manual")).toHaveLength(
      1,
    );
  });
});

function journalEntry(
  applyId: string,
  createdAt: string,
  min: number,
): JournalEntry {
  return {
    version: 1,
    applyId,
    target: "sbx-000001",
    buildDir: "/b",
    world: "world",
    min: { x: min, y: 0, z: 0 },
    max: { x: min + 4, y: 4, z: 4 },
    planHash: "p",
    snapshotId: "snap-1",
    siteHash: "s",
    status: "verified",
    mismatches: 0,
    createdAt,
    updatedAt: createdAt,
  };
}

describe("journal", () => {
  it("generates sortable ids and enforces last-in-first-out undo for overlaps", async () => {
    expect(Journal.newId(new Date(0))).toMatch(/^apply-0-[0-9a-z]{4}$/u);
    const journal = new Journal(path.join(temp, "journal"));
    await journal.write(journalEntry("apply-a", "2026-10-01T00:00:00Z", 0));
    await journal.write(journalEntry("apply-b", "2026-10-02T00:00:00Z", 2));
    await journal.write(journalEntry("apply-c", "2026-10-03T00:00:00Z", 50));
    const first = await journal.find("apply-a");
    const blockers = await journal.blockers(first);
    expect(blockers.map((other) => other.applyId)).toEqual(["apply-b"]);
    const second = await journal.find("apply-b");
    await journal.write({ ...second, status: "undone" });
    expect(await journal.blockers(first)).toEqual([]);
  });
});

describe("diffGrids", () => {
  it("reports mismatches in world coordinates", () => {
    const expected = new BlockGrid({ x: 2, y: 1, z: 1 });
    const actual = new BlockGrid({ x: 2, y: 1, z: 1 });
    actual.set(1, 0, 0, "stone");
    expect(diffGrids(expected, actual, { x: 10, y: 20, z: 30 })).toEqual({
      mismatches: 1,
      samples: [
        {
          at: { x: 11, y: 20, z: 30 },
          expected: "minecraft:air",
          actual: "minecraft:stone",
        },
      ],
    });
  });
});
