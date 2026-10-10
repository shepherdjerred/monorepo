import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { BlockGrid } from "@shepherdjerred/mc-build/core/grid.ts";
import { writeSchematic } from "@shepherdjerred/mc-build/core/schem.ts";
import { loadRegistry } from "@shepherdjerred/mc-build/registry/registry.ts";
import { compileBuild, initBuild, regionInSite } from "#build/commands.ts";
import { DaemonClient } from "#build/daemon-client.ts";
import { compiledGrid } from "#build/sources.ts";
import { readLog } from "#build/build-log.ts";
import { resumeState } from "#build/resume.ts";
import { flatSiteBuild } from "./fixtures/flat-site.ts";
import { Journal, type JournalEntry } from "#build/journal.ts";
import { diffGrids, runOps } from "#build/ops.ts";
import { BuildWorkspace } from "#build/workspace.ts";
import type { WeOp } from "#protocol/bridge.ts";
import {
  appendOp,
  BUILD_FILES,
  OpLogSchema,
  readOpLog,
  type Op,
} from "#protocol/build.ts";

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
        changed: 0,
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
      `paste:${id}:${request.at.x.toString()},${request.at.y.toString()},${request.at.z.toString()}:${request.ignoreAir.toString()}:history=${String(request.history)}`,
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

function pasteOp(schematic: string): Op {
  return {
    kind: "paste",
    world: "world",
    schematic,
    at: { x: 0, y: 0, z: 0 },
    rotate: 0,
    ignoreAir: true,
    source: "manual",
  };
}

describe("runOps pastes", () => {
  it("keeps ordinary pastes in we-undo history and skips it for map-scale ones", async () => {
    const workspace = new BuildWorkspace(temp);
    const small = new BlockGrid({ x: 3, y: 3, z: 3 });
    small.set(1, 1, 1, "minecraft:stone");
    const big = new BlockGrid({ x: 101, y: 100, z: 100 });
    big.set(0, 0, 0, "minecraft:stone");
    await Bun.write(
      path.join(temp, "small.schem"),
      writeSchematic(small, 4903),
    );
    await Bun.write(path.join(temp, "big.schem"), writeSchematic(big, 4903));
    const client = new FakeClient();
    await runOps({ client, target: "sbx-000001", workspace, session: "s" }, [
      pasteOp("small.schem"),
      pasteOp("big.schem"),
    ]);
    expect(client.calls).toEqual([
      "paste:sbx-000001:0,0,0:true:history=true",
      "paste:sbx-000001:0,0,0:true:history=false",
    ]);
  });
});

describe("compileBuild", () => {
  it("journals every tiled paste and clear through the real CLI", async () => {
    const dir = path.join(temp, "tiled-journal");
    await initBuild(dir, {
      name: "tiled-journal",
      world: "world",
      anchor: { x: 0, y: 0, z: 0 },
      seed: 1,
    });
    await Bun.write(
      path.join(dir, "build.ts"),
      `export default ((ctx) => {
      const box = {x: 0, y: 0, z: 0, w: 1001, h: 1, d: 1};
      ctx.clear({...box, y: 1});
      ctx.fill(box, "minecraft:stone");
    });`,
    );
    await appendOp(dir, weOp("//set dirt_path"));
    const proc = Bun.spawn(
      [
        process.execPath,
        path.resolve(import.meta.dirname, "../src/build/cli.ts"),
        "compile",
        dir,
        "--json",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout) as unknown).toMatchObject({ ops: 3, clears: 1 });
    const log = await readOpLog(dir);
    const program = log.ops.filter((op) => op.source.startsWith("program:"));
    expect(program).toHaveLength(3);
    expect(program.filter((op) => op.kind === "paste")).toHaveLength(2);
    const journal = await readLog(dir);
    expect(journal.at(-1)).toMatchObject({
      kind: "compile",
      ops: program.length,
    });
    const state = await resumeState(dir);
    expect(state.ops).toEqual({ program: 3, manual: 1, import: 0 });
  });

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

  it("keeps a snapshot per program text, even when the blocks come out the same", async () => {
    const dir = path.join(temp, "snapshots");
    await initBuild(dir, {
      name: "snapshots",
      world: "world",
      anchor: { x: 100, y: -60, z: 200 },
      seed: 42,
    });
    const program = path.join(dir, "build.ts");
    await Bun.write(program, Bun.file(COTTAGE));
    await compileBuild(dir);
    const digestOf = async (): Promise<string> => {
      const log = await readOpLog(dir);
      const source = log.ops.find((op) => op.source.startsWith("program:"));
      if (source === undefined) throw new Error("no program op");
      return source.source.slice("program:".length);
    };
    const first = await digestOf();
    const text = await Bun.file(program).text();
    await Bun.write(program, `${text}\n// a comment: same blocks, new text\n`);
    await compileBuild(dir);
    const second = await digestOf();
    expect(second).not.toBe(first);
    const schematics = await readdir(path.join(dir, "schematics"));
    expect(
      schematics.filter((file) => file.endsWith(".build.ts")),
    ).toHaveLength(2);
    expect(
      await Bun.file(
        path.join(dir, "schematics", `program-${first}.build.ts`),
      ).text(),
    ).not.toContain("same blocks, new text");
    expect(
      await Bun.file(
        path.join(dir, "schematics", `program-${second}.build.ts`),
      ).text(),
    ).toContain("same blocks, new text");
  }, 120_000);
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

describe("compiled source", () => {
  it("applies unrotated paste ops to the captured site offline and lists the rest", async () => {
    const workspace = await flatSiteBuild(
      path.join(temp, "compiled"),
      "compiled",
    );
    const registry = await loadRegistry();
    const part = new BlockGrid({ x: 2, y: 2, z: 2 });
    part.set(0, 0, 0, "minecraft:stone");
    part.set(1, 1, 1, "minecraft:oak_planks");
    await Bun.write(
      workspace.file(path.join(BUILD_FILES.schematicsDir, "part.schem")),
      writeSchematic(part, registry.dataVersion),
    );
    await workspace.writeOplog({
      version: 1,
      ops: [
        {
          kind: "paste",
          world: "world",
          schematic: path.join(BUILD_FILES.schematicsDir, "part.schem"),
          at: { x: 103, y: 65, z: 103 },
          rotate: 0,
          ignoreAir: true,
          source: "program:abc",
        },
        {
          kind: "we",
          world: "world",
          command: "//set stone",
          source: "manual",
        },
        {
          kind: "we",
          world: "world",
          command: "//set air",
          pos1: { x: 100, y: 64, z: 100 },
          pos2: { x: 101, y: 64, z: 101 },
          source: "program:abc",
        },
      ],
    });
    const { grid, skipped } = await compiledGrid(
      workspace,
      await workspace.manifest(),
    );
    // The compiler's clear box applies offline; the grass under it is gone.
    expect(grid.get(0, 0, 0)).toBe("minecraft:air");
    expect(grid.get(2, 0, 2)).toBe("minecraft:grass_block[snowy=false]");
    expect(grid.get(3, 1, 3)).toBe("minecraft:stone");
    expect(grid.get(4, 2, 4)).toBe("minecraft:oak_planks");
    // ignoreAir left the site's grass where the part had air.
    expect(grid.get(4, 0, 4)).toBe("minecraft:grass_block[snowy=false]");
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toContain("we");
  });
});

describe("regionInSite", () => {
  const site = {
    world: "world",
    min: { x: 0, y: -64, z: 0 },
    max: { x: 95, y: -20, z: 95 },
  };

  it("normalizes corners inside the site", () => {
    expect(
      regionInSite(site, {
        min: { x: 40, y: -30, z: 10 },
        max: { x: 20, y: -64, z: 30 },
      }),
    ).toEqual({
      world: "world",
      min: { x: 20, y: -64, z: 10 },
      max: { x: 40, y: -30, z: 30 },
    });
  });

  it("refuses a region that leaves the site", () => {
    expect(() =>
      regionInSite(site, {
        min: { x: 80, y: -64, z: 80 },
        max: { x: 100, y: -40, z: 90 },
      }),
    ).toThrow(/outside the site 0,-64,0 → 95,-20,95/u);
  });
});
