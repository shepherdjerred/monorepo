import { mkdtemp, rm } from "node:fs/promises";
import type * as FileSystem from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { BlockGrid } from "@shepherdjerred/mc-build/core/grid.ts";
import {
  readSchematic,
  writeSchematic,
} from "@shepherdjerred/mc-build/core/schem.ts";
import { BUILD_FILES } from "#protocol/build.ts";
import { runBuild, renderBuild } from "#build/commands.ts";
import { promoteBuild } from "#build/apply.ts";
import { validateFrozenExpected } from "#build/frozen-expected.ts";
import { readLog } from "#build/build-log.ts";
import { DaemonClient } from "#build/daemon-client.ts";
import { Journal } from "#build/journal.ts";
import {
  flatSiteBuild,
  regionForGrid as regionOf,
} from "./fixtures/flat-site.ts";
import { writeRunIdentity } from "#build/storage/run-identity.ts";

const journalFailure = vi.hoisted(() => ({ file: "" }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof FileSystem>();
  return {
    ...original,
    appendFile: async (...args: Parameters<typeof original.appendFile>) => {
      if (
        journalFailure.file !== "" &&
        typeof args[0] === "string" &&
        args[0].startsWith(path.dirname(journalFailure.file) + path.sep) &&
        args[0].endsWith(path.sep + BUILD_FILES.journal)
      )
        throw new Error("simulated journal append failure");
      return original.appendFile(...args);
    },
  };
});

const root = await mkdtemp(path.join(os.tmpdir(), "mc-expected-evidence-"));
afterAll(async () => rm(root, { recursive: true }));

async function build(name: string) {
  const workspace = await flatSiteBuild(path.join(root, name), name);
  await workspace.writeOplog({ version: 1, ops: [] });
  const site = await readSchematic(
    await Bun.file(workspace.file(BUILD_FILES.siteSchematic)).bytes(),
  );
  const region = regionOf(site.grid);
  await workspace.writeExpected(region);
  await workspace.writeFrozen("expected", [
    { at: region.min, bytes: writeSchematic(site.grid, site.dataVersion) },
  ]);
  return { workspace, site, region };
}

describe("frozen expected evidence", () => {
  it.each(["single", "tiled"])(
    "restores the previous %s run when journaling a changed run fails",
    async (kind) => {
      const { workspace, site, region } = await build(`journal-${kind}`);
      const client = new DaemonClient();
      vi.spyOn(client, "paste").mockResolvedValue({
        changed: 0,
        min: region.min,
        max: region.max,
        historySize: 0,
      });
      const snapshots = vi.spyOn(client, "snapshotParts").mockResolvedValue({
        id: "original",
        parts: [{ id: "original", box: region }],
      });
      const bytes = vi
        .spyOn(client, "snapshotBytes")
        .mockResolvedValue(writeSchematic(site.grid, site.dataVersion));
      const reads = vi.spyOn(client, "regionRead").mockResolvedValue(region);
      const env = {
        client,
        journal: new Journal(workspace.file("audit")),
        log: vi.fn(),
      };
      await runBuild(env, workspace.dir, { target: "sbx-000001" });
      if (kind === "tiled") {
        const tiles = [0, 5].map((x) => {
          const grid = new BlockGrid({ x: 5, y: 10, z: 10 });
          grid.forEach((cx, y, z) =>
            grid.set(cx, y, z, site.grid.get(cx + x, y, z)),
          );
          return {
            at: { ...region.min, x: region.min.x + x },
            bytes: writeSchematic(grid, site.dataVersion),
          };
        });
        await workspace.writeFrozen("expected", tiles);
        const entries = await readLog(workspace.dir);
        const run = entries.findLast((entry) => entry.kind === "run");
        if (run?.kind !== "run" || run.id === undefined)
          throw new Error("missing run identity fixture");
        await writeRunIdentity(workspace, run.id);
      }
      const before = await workspace.expected();
      const partsBefore = await workspace.frozenParts("expected", region);
      const journal = await readLog(workspace.dir);
      const changed = new BlockGrid(site.grid.size, "minecraft:stone");
      snapshots.mockResolvedValue({
        id: "changed",
        parts: [{ id: "changed", box: region }],
      });
      bytes.mockResolvedValue(writeSchematic(changed, site.dataVersion));
      reads.mockResolvedValue(regionOf(changed));
      journalFailure.file = workspace.file(BUILD_FILES.journal);
      try {
        await expect(
          runBuild(env, workspace.dir, { target: "sbx-000001" }),
        ).rejects.toThrow(/journal append failure/u);
      } finally {
        journalFailure.file = "";
      }
      expect(await readLog(workspace.dir)).toEqual(journal);
      const restored = await workspace.expected();
      expect(restored.diff(before).count).toBe(0);
      expect(await workspace.frozenParts("expected", region)).toEqual(
        partsBefore,
      );
      await runBuild(env, workspace.dir, { target: "sbx-000001" });
      const retried = await workspace.expected();
      expect(retried.diff(changed).count).toBe(0);
      expect(await readLog(workspace.dir)).toHaveLength(journal.length + 1);
      const completed = await readLog(workspace.dir);
      for (const legacy of [false, true]) {
        const interrupted = journal.map((entry) => {
          if (legacy && entry.kind === "run") {
            const { id: _id, ...previous } = entry;
            return previous;
          }
          return entry;
        });
        await Bun.write(
          workspace.file(BUILD_FILES.journal),
          interrupted.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
        );
        await expect(workspace.expected()).rejects.toThrow(/run identity/u);
        await expect(workspace.frozenParts("expected", region)).rejects.toThrow(
          /run identity/u,
        );
        await expect(
          renderBuild(env, workspace.dir, { source: "expected" }),
        ).rejects.toThrow(/run identity/u);
        await expect(
          promoteBuild(env, workspace.dir, { target: "sbx-000001" }),
        ).rejects.toThrow(/run identity/u);
      }
      await Bun.write(
        workspace.file(BUILD_FILES.journal),
        completed.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
      );
      const resumed = await workspace.expected();
      expect(resumed.diff(changed).count).toBe(0);
    },
  );
});

describe("frozen expected provenance", () => {
  it.each(["json", "schematic", "world", "placement", "missing"])(
    "rejects mismatched %s before rendering or promotion mutation",
    async (failure) => {
      const { workspace, site, region } = await build(`mismatch-${failure}`);
      expect(await workspace.expected()).toMatchObject({
        size: site.grid.size,
      });
      switch (failure) {
        case "json":
          await workspace.writeExpected({
            ...region,
            palette: ["minecraft:stone", ...region.palette.slice(1)],
          });
          break;
        case "schematic":
          await workspace.writeFrozen("expected", [
            {
              at: region.min,
              bytes: writeSchematic(
                new BlockGrid(site.grid.size, "minecraft:stone"),
                site.dataVersion,
              ),
            },
          ]);
          break;
        case "world":
          await workspace.writeExpected({ ...region, world: "another" });
          break;
        case "placement":
          await workspace.writeExpected({
            ...region,
            min: { ...region.min, x: region.min.x + 1 },
            max: { ...region.max, x: region.max.x + 1 },
          });
          break;
        case "missing":
          await rm(workspace.file(BUILD_FILES.expectedSchematic));
          break;
        default:
          throw new Error("unknown fixture");
      }
      const client = new DaemonClient();
      const reads = vi.spyOn(client, "regionRead");
      const snapshots = vi.spyOn(client, "snapshotParts");
      const pastes = vi.spyOn(client, "paste");
      const env = {
        client,
        journal: new Journal(workspace.file("audit")),
        log: vi.fn(),
      };
      const journal = await readLog(workspace.dir);
      await expect(workspace.expected()).rejects.toThrow();
      await expect(
        renderBuild(env, workspace.dir, {
          source: "expected",
          name: "invalid",
        }),
      ).rejects.toThrow();
      await expect(
        promoteBuild(env, workspace.dir, { target: "sbx-000001" }),
      ).rejects.toThrow();
      for (const call of [reads, snapshots, pastes])
        expect(call).not.toHaveBeenCalled();
      expect(await readLog(workspace.dir)).toEqual(journal);
      expect(
        await Bun.file(workspace.file("renders/invalid.json")).exists(),
      ).toBe(false);
    },
  );

  it("rejects a canvas change between snapshot and region read before publishing the run", async () => {
    const { workspace, site, region } = await build("run-race");
    const before = await Promise.all(
      [BUILD_FILES.expected, BUILD_FILES.expectedSchematic].map((file) =>
        Bun.file(workspace.file(file)).bytes(),
      ),
    );
    const journal = await readLog(workspace.dir);
    const client = new DaemonClient();
    vi.spyOn(client, "paste").mockResolvedValue({
      changed: 0,
      min: region.min,
      max: region.max,
      historySize: 0,
    });
    vi.spyOn(client, "snapshotParts").mockResolvedValue({
      id: "frozen",
      parts: [{ id: "frozen", box: region }],
    });
    const frozen = new BlockGrid(site.grid.size);
    vi.spyOn(client, "snapshotBytes").mockResolvedValue(
      writeSchematic(frozen, site.dataVersion),
    );
    const read = vi.spyOn(client, "regionRead").mockResolvedValue(region);
    const env = {
      client,
      journal: new Journal(workspace.file("audit")),
      log: vi.fn(),
    };
    await expect(
      runBuild(env, workspace.dir, { target: "sbx-000001" }),
    ).rejects.toThrow(/does not match the frozen run/u);
    expect(await readLog(workspace.dir)).toEqual(journal);
    expect(
      await Promise.all(
        [BUILD_FILES.expected, BUILD_FILES.expectedSchematic].map((file) =>
          Bun.file(workspace.file(file)).bytes(),
        ),
      ),
    ).toEqual(before);
    read.mockResolvedValue(regionOf(frozen));
    await runBuild(env, workspace.dir, { target: "sbx-000001" });
    const expected = await workspace.expected();
    expect(expected.get(0, 0, 0)).toBe("minecraft:air");
    expect(await readLog(workspace.dir)).toHaveLength(journal.length + 1);
  });
});

describe("tiled expected evidence", () => {
  it.each(["valid", "overlap", "gap", "outside", "changed"])(
    "validates %s tiles with exact full coverage",
    async (kind) => {
      const region = regionOf(
        new BlockGrid({ x: 4, y: 2, z: 2 }, "minecraft:stone"),
      );
      const { site } = await build(`tiles-${kind}`);
      const bytes = writeSchematic(
        new BlockGrid({ x: 2, y: 2, z: 2 }, "minecraft:stone"),
        site.dataVersion,
      );
      const parts = [
        { at: region.min, bytes },
        { at: { ...region.min, x: region.min.x + 2 }, bytes },
      ];
      const second = parts[1];
      if (second === undefined) throw new Error("missing fixture part");
      if (kind === "overlap") second.at = region.min;
      if (kind === "outside") second.at = { ...second.at, x: second.at.x + 1 };
      if (kind === "gap") parts.pop();
      if (kind === "changed")
        second.bytes = writeSchematic(
          new BlockGrid({ x: 2, y: 2, z: 2 }, "minecraft:dirt"),
          site.dataVersion,
        );
      const result = validateFrozenExpected(region, region, parts);
      if (kind === "valid")
        expect(await result).toMatchObject({ size: region.size });
      else await expect(result).rejects.toThrow();
    },
  );
});
