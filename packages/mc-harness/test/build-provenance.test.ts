import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { BlockGrid } from "@shepherdjerred/mc-build/core/grid.ts";
import { RegionReadSchema } from "@shepherdjerred/mc-build/core/region-read.ts";
import { appendLog, readLog } from "#build/build-log.ts";
import { runBuild } from "#build/commands.ts";
import { DaemonClient } from "#build/daemon-client.ts";
import { readRenderProvenance, renderLooks } from "#build/helpers.ts";
import { Journal } from "#build/journal.ts";
import { rubricAxisIds } from "#build/judge.ts";
import { latestRenderName, programSnapshot } from "#build/sidecar.ts";
import {
  listCandidates,
  readCandidate,
  saveCandidate,
} from "#build/studio/candidates.ts";
import { critiqueBuild } from "#build/studio/critique.ts";
import { BUILD_FILES, JudgeCritiqueRecordSchema } from "#protocol/build.ts";
import { flatSiteBuild } from "./fixtures/flat-site.ts";

const temp = await mkdtemp(path.join(os.tmpdir(), "mc-build-provenance-"));
afterAll(async () => {
  await rm(temp, { recursive: true, force: true });
});

async function programBuild(name: string) {
  const workspace = await flatSiteBuild(path.join(temp, name), name);
  const manifest = await workspace.manifest();
  await workspace.writeManifest({ ...manifest, canvas: "sbx-000001" });
  await workspace.writeOplog({
    version: 1,
    ops: [{ kind: "command", command: "say fixture", source: "program:abc" }],
  });
  await Bun.write(
    workspace.file(programSnapshot("abc")),
    "export default (()=>{}) satisfies unknown;\n",
  );
  await appendLog(workspace.dir, {
    kind: "run",
    target: "sbx-000001",
    ops: 1,
    program: programSnapshot("abc"),
  });
  await workspace.writeExpected({
    ...workspace.siteBox(manifest),
    size: { x: 10, y: 10, z: 10 },
    palette: ["minecraft:air"],
    blocks: Buffer.alloc(4000).toString("base64"),
    blockEntities: [],
  });
  return workspace;
}

describe("capture and run provenance", () => {
  it("requires a current-capture render before implicit critique", async () => {
    const workspace = await programBuild("implicit-capture");
    const grid = new BlockGrid({ x: 2, y: 2, z: 2 }, "minecraft:stone");
    await renderLooks(workspace, grid, "old", {
      source: "compiled",
      views: ["sheet"],
    });
    await appendLog(workspace.dir, {
      kind: "render",
      name: "old",
      source: "compiled",
      files: ["renders/old.png"],
    });
    await appendLog(workspace.dir, {
      kind: "capture",
      siteHash: "new",
      box: workspace.siteBox(await workspace.manifest()),
    });
    const journal = await readLog(workspace.dir);
    const ask = vi.fn(() => Promise.reject(new Error("unexpected judge")));
    await expect(
      critiqueBuild(workspace.dir, {
        rubric: "micro",
        model: "stub",
        stage: "visual",
        ask,
      }),
    ).rejects.toThrow(/current capture has no render/u);
    expect(ask).not.toHaveBeenCalled();
    expect(await readLog(workspace.dir)).toEqual(journal);
    await renderLooks(workspace, grid, "current", {
      source: "compiled",
      views: ["sheet"],
    });
    await appendLog(workspace.dir, {
      kind: "render",
      name: "current",
      source: "compiled",
      files: ["renders/current.png"],
    });
    expect(
      await latestRenderName(workspace, await readLog(workspace.dir)),
    ).toBe("current");
    expect(await Bun.file(workspace.file("renders/old.json")).exists()).toBe(
      true,
    );
  }, 60_000);

  it("preserves a forced candidate replacement when writing the staged grid fails", async () => {
    const workspace = await flatSiteBuild(
      path.join(temp, "candidate-write-failure"),
      "candidate-write-failure",
    );
    await workspace.writeOplog({ version: 1, ops: [] });
    const old = await saveCandidate(workspace.dir, "saved");
    const file = workspace.file("candidates/saved/candidate.schem");
    const bytes = await Bun.file(file).bytes();
    const journal = await readLog(workspace.dir);
    const write = vi
      .spyOn(Bun, "write")
      .mockRejectedValueOnce(new Error("simulated disk full"));
    try {
      await expect(
        saveCandidate(workspace.dir, "saved", { force: true }),
      ).rejects.toThrow(/simulated disk full/u);
    } finally {
      write.mockRestore();
    }
    expect(await readCandidate(workspace.dir, "saved")).toEqual(old);
    expect(await Bun.file(file).bytes()).toEqual(bytes);
    expect(await readLog(workspace.dir)).toEqual(journal);
    const listed = await listCandidates(workspace.dir);
    expect(listed.map(({ name }) => name)).toEqual(["saved"]);
    const names = await readdir(workspace.dir);
    expect(names.some((name) => name.startsWith(".candidate-"))).toBe(false);
    await saveCandidate(workspace.dir, "saved", { force: true });
    expect(await readCandidate(workspace.dir, "saved")).toMatchObject({
      name: "saved",
      gridHash: old.gridHash,
    });
  });

  it("requires a run after recapture for expected data and canvas provenance", async () => {
    const workspace = await programBuild("recapture");
    const before = await readRenderProvenance(workspace, "expected");
    expect(before.programText).not.toBeNull();
    await Bun.write(
      workspace.file(BUILD_FILES.expectedSchematic),
      "old frozen snapshot",
    );
    await appendLog(workspace.dir, {
      kind: "capture",
      siteHash: "recaptured",
      box: workspace.siteBox(await workspace.manifest()),
    });
    const expected = await readRenderProvenance(workspace, "expected");
    const canvas = await readRenderProvenance(
      workspace,
      "canvas",
      "sbx-000001",
    );
    const compiled = await readRenderProvenance(workspace, "compiled");
    expect(expected.programText).toBeNull();
    expect(canvas.programText).toBeNull();
    expect(compiled.programText).not.toBeNull();
    await expect(workspace.expected()).rejects.toThrow(/current capture/u);
    await expect(
      workspace.frozenParts(
        "expected",
        workspace.siteBox(await workspace.manifest()),
      ),
    ).rejects.toThrow(/current capture/u);
    const previous = RegionReadSchema.parse(
      await Bun.file(workspace.file(BUILD_FILES.expected)).json(),
    );
    await workspace.writeExpected({
      ...previous,
      palette: ["minecraft:stone"],
    });
    await Bun.write(
      workspace.file(BUILD_FILES.expectedSchematic),
      "new frozen snapshot",
    );
    await appendLog(workspace.dir, {
      kind: "run",
      target: "sbx-000002",
      ops: 1,
      program: programSnapshot("abc"),
    });
    const rerun = await readRenderProvenance(workspace, "canvas", "sbx-000002");
    const rerunGrid = await workspace.expected();
    expect(rerun.programText).not.toBeNull();
    expect(rerunGrid.get(0, 0, 0)).toBe("minecraft:stone");
    expect(
      await Bun.file(workspace.file(BUILD_FILES.expectedSchematic)).text(),
    ).toBe("new frozen snapshot");
  });

  it("rejects missing producer snapshots before any sandbox or expected-state mutation", async () => {
    const workspace = await programBuild("run-missing-producer");
    await workspace.writeOplog({
      version: 1,
      ops: [
        { kind: "command", command: "say changed", source: "program:missing" },
      ],
    });
    await Bun.write(
      workspace.file(BUILD_FILES.expectedSchematic),
      "old frozen snapshot",
    );
    const expected = await Bun.file(
      workspace.file(BUILD_FILES.expected),
    ).text();
    const journal = await readLog(workspace.dir);
    const client = new DaemonClient();
    const calls = [
      vi.spyOn(client, "paste"),
      vi.spyOn(client, "command"),
      vi.spyOn(client, "snapshotParts"),
      vi.spyOn(client, "snapshotBytes"),
      vi.spyOn(client, "regionRead"),
    ];
    await expect(
      runBuild(
        { client, journal: new Journal(workspace.file("audit")), log: vi.fn() },
        workspace.dir,
        {},
      ),
    ).rejects.toThrow(/missing producing program snapshot/u);
    for (const call of calls) expect(call).not.toHaveBeenCalled();
    expect(await Bun.file(workspace.file(BUILD_FILES.expected)).text()).toBe(
      expected,
    );
    expect(
      await Bun.file(workspace.file(BUILD_FILES.expectedSchematic)).text(),
    ).toBe("old frozen snapshot");
    expect(await readLog(workspace.dir)).toEqual(journal);
  });
});

describe("reused critique identity", () => {
  it.each(["../../outside.ts", "/tmp/outside.ts", "renders/other.build.ts"])(
    "rejects program path %s before reading or reviewing it",
    async (program) => {
      const workspace = await programBuild(
        `path-${program.startsWith("/") ? "absolute" : program.startsWith("..") ? "parent" : "other"}`,
      );
      await renderLooks(
        workspace,
        new BlockGrid({ x: 2, y: 2, z: 2 }, "minecraft:stone"),
        "look",
        {
          source: "compiled",
          views: ["sheet"],
        },
      );
      const file = workspace.file("renders/look.json");
      const sidecar: unknown = await Bun.file(file).json();
      if (typeof sidecar !== "object" || sidecar === null)
        throw new Error("invalid fixture");
      const corrupt = JSON.stringify({ ...sidecar, program });
      await Bun.write(file, corrupt);
      const journal = await readLog(workspace.dir);
      const ask = vi.fn(() =>
        Promise.reject(new Error("unexpected visual call")),
      );
      const askCode = vi.fn(() => Promise.resolve({ suggestions: [] }));
      for (const stage of ["code", "both"] as const) {
        await expect(
          critiqueBuild(workspace.dir, {
            render: "look",
            rubric: "micro",
            model: "stub",
            stage,
            ask,
            askCode,
          }),
        ).rejects.toThrow(/must reference program/u);
      }
      expect(ask).not.toHaveBeenCalled();
      expect(askCode).not.toHaveBeenCalled();
      expect(await readLog(workspace.dir)).toEqual(journal);
      expect(await Bun.file(file).text()).toBe(corrupt);
    },
    60_000,
  );

  it.each(["render", "gridHash", "rubric", "total", "max"] as const)(
    "rejects a mismatched %s before code review",
    async (field) => {
      const workspace = await programBuild(`critique-${field.toLowerCase()}`);
      await renderLooks(
        workspace,
        new BlockGrid({ x: 10, y: 10, z: 10 }, "minecraft:stone"),
        "look",
        { source: "compiled", views: ["sheet"] },
      );
      const visual = await critiqueBuild(workspace.dir, {
        render: "look",
        rubric: "micro",
        model: "visual",
        stage: "visual",
        byEye: {
          axes: Object.fromEntries(
            rubricAxisIds("micro").map((axis) => [axis, 3]),
          ),
          overallAesthetic: 3,
          notes: [],
        },
      });
      const file = workspace.file(visual.record);
      const record = JudgeCritiqueRecordSchema.parse(
        await Bun.file(file).json(),
      );
      const changed = {
        ...record,
        [field]:
          field === "rubric"
            ? "map"
            : field === "total" || field === "max"
              ? record[field] + 1
              : "another",
      };
      await Bun.write(file, JSON.stringify(changed));
      const journal = await readLog(workspace.dir);
      const sidecar = await Bun.file(
        workspace.file("renders/look.json"),
      ).text();
      const askCode = vi.fn(() => Promise.resolve({ suggestions: [] }));
      await expect(
        critiqueBuild(workspace.dir, {
          render: "look",
          rubric: "micro",
          model: "code",
          stage: "code",
          askCode,
        }),
      ).rejects.toThrow(/does not match its journal entry/u);
      expect(askCode).not.toHaveBeenCalled();
      expect(await readLog(workspace.dir)).toEqual(journal);
      expect(await Bun.file(workspace.file("renders/look.json")).text()).toBe(
        sidecar,
      );
      expect(await Bun.file(file).json()).toEqual(changed);
    },
    60_000,
  );
});
