import { mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import type * as FileSystem from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { BlockGrid } from "@shepherdjerred/mc-build/core/grid.ts";
import {
  readSchematic,
  writeSchematic,
} from "@shepherdjerred/mc-build/core/schem.ts";
import { RegionReadSchema } from "@shepherdjerred/mc-build/core/region-read.ts";
import { appendLog, readLog } from "#build/build-log.ts";
import { renderBuild, runBuild } from "#build/commands.ts";
import { DaemonClient } from "#build/daemon-client.ts";
import { renderLooks } from "#build/helpers.ts";
import { Journal } from "#build/journal.ts";
import { rubricAxisIds } from "#build/judge.ts";
import {
  latestRenderName,
  programSnapshot,
  readRenderProvenance,
} from "#build/sidecar.ts";
import {
  listCandidates,
  pickCandidate,
  readCandidate,
  saveCandidate,
} from "#build/studio/candidates.ts";
import { critiqueBuild } from "#build/studio/critique.ts";
import { knockout } from "#build/studio/knockout.ts";
import { resumeState } from "#build/resume.ts";
import {
  BUILD_FILES,
  JudgeCritiqueRecordSchema,
  type Op,
} from "#protocol/build.ts";
import { clearFloorOp, flatSiteBuild } from "./fixtures/flat-site.ts";
import { readJournal } from "#evals/grade/trajectory.ts";

vi.mock("@shepherdjerred/mc-build/render/assets.ts", async () => {
  const { renderAssets } = await import("./fixtures/render-assets.ts");
  return { ensureAssets: renderAssets };
});

const temp = await mkdtemp(path.join(os.tmpdir(), "mc-build-provenance-"));
async function corruptCritiqueScores(
  workspace: Awaited<ReturnType<typeof flatSiteBuild>>,
  file: string,
  failure: string,
) {
  const content = JudgeCritiqueRecordSchema.parse(await Bun.file(file).json());
  switch (failure) {
    case "total":
      content.total = 40;
      break;
    case "max":
      content.max = 50;
      break;
    case "lowest":
      content.lowest = "depth";
      break;
    case "missing-axis":
      delete content.axes["lighting"];
      break;
    case "extra-axis":
      content.axes["invented"] = 3;
      break;
    default:
      throw new Error("unknown corruption");
  }
  await Bun.write(file, JSON.stringify(content));
  const entries = await readLog(workspace.dir);
  await Bun.write(
    workspace.file(BUILD_FILES.journal),
    entries
      .map((entry) =>
        JSON.stringify(
          entry.kind === "critique"
            ? {
                ...entry,
                total: content.total,
                max: content.max,
                lowest: content.lowest,
              }
            : entry,
        ),
      )
      .join("\n") + "\n",
  );
}
const restoreFailure = vi.hoisted(() => ({ enabled: false }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof FileSystem>();
  return {
    ...original,
    rename: async (...args: Parameters<typeof original.rename>) => {
      const [from, to] = args.map(String);
      if (
        restoreFailure.enabled &&
        from?.includes(".pick-") === true &&
        from.endsWith(`/${BUILD_FILES.oplog}`) &&
        to?.endsWith(`/${BUILD_FILES.oplog}`) === true
      ) {
        restoreFailure.enabled = false;
        throw new Error("simulated install failure");
      }
      return original.rename(...args);
    },
  };
});
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
  const site = await readSchematic(
    await Bun.file(workspace.file(BUILD_FILES.siteSchematic)).bytes(),
  );
  await workspace.writeFrozen("expected", [
    {
      at: workspace.siteBox(manifest).min,
      bytes: writeSchematic(
        new BlockGrid({ x: 10, y: 10, z: 10 }),
        site.dataVersion,
      ),
    },
  ]);
  return workspace;
}

describe("complete compiled render evidence", () => {
  it.each(["plain", "looks", "candidate"])(
    "rejects a substituted captured site before %s evidence writes",
    async (operation) => {
      const workspace = await flatSiteBuild(
        path.join(temp, `site-hash-${operation}`),
        "site-hash",
      );
      await workspace.writeOplog({ version: 1, ops: [] });
      const original = await Bun.file(
        workspace.file(BUILD_FILES.siteSchematic),
      ).bytes();
      const schematic = await readSchematic(original);
      schematic.grid.set(0, 1, 0, "minecraft:stone");
      await Bun.write(
        workspace.file(BUILD_FILES.siteSchematic),
        writeSchematic(schematic.grid, schematic.dataVersion),
      );
      const before = await readLog(workspace.dir);
      const manifest = await workspace.manifest();
      const env = {
        client: new DaemonClient(),
        journal: new Journal(workspace.file("audit")),
        log: vi.fn(),
      };
      if (operation === "candidate") {
        await expect(saveCandidate(workspace.dir, "invalid")).rejects.toThrow(
          /siteHash/u,
        );
      } else {
        await expect(
          renderBuild(env, workspace.dir, {
            source: "compiled",
            name: "invalid",
            ...(operation === "looks" ? { views: ["sheet" as const] } : {}),
          }),
        ).rejects.toThrow(/siteHash/u);
      }
      expect(await readLog(workspace.dir)).toEqual(before);
      expect(await workspace.manifest()).toEqual(manifest);
      expect(
        await Bun.file(workspace.file("renders/invalid.json")).exists(),
      ).toBe(false);
      expect(
        await Bun.file(
          workspace.file("candidates/invalid/candidate.json"),
        ).exists(),
      ).toBe(false);
      await Bun.write(workspace.file(BUILD_FILES.siteSchematic), original);
      expect(await saveCandidate(workspace.dir, "valid")).toMatchObject({
        name: "valid",
      });
    },
  );

  it.each(
    ["plain", "looks"].flatMap((look) =>
      ["console", "worldedit", "rotation", "world"].map((kind) => ({
        look,
        kind,
      })),
    ),
  )(
    "rejects incomplete $kind evidence in $look renders",
    async ({ look, kind }) => {
      const workspace = await flatSiteBuild(
        path.join(temp, `partial-${kind}-${look}`),
        `partial-${kind}-${look}`,
      );
      await workspace.writeOplog({ version: 1, ops: [] });
      const env = {
        client: new DaemonClient(),
        journal: new Journal(workspace.file("audit")),
        log: vi.fn(),
      };
      await renderBuild(env, workspace.dir, {
        source: "compiled",
        name: "kept",
      });
      const files = ["png", "schem", "json"].map((suffix) =>
        Bun.file(workspace.file(`renders/kept.${suffix}`)),
      );
      const before = await Promise.all(files.map((file) => file.bytes()));
      const journal = await readLog(workspace.dir);
      const paste: Op = {
        kind: "paste",
        schematic: BUILD_FILES.siteSchematic,
        world: kind === "world" ? "another-world" : "world",
        at: { x: 100, y: 64, z: 100 },
        rotate: kind === "rotation" ? 90 : 0,
        ignoreAir: false,
        source: "manual",
      };
      const op: Op =
        kind === "console"
          ? { kind: "command", command: "say omitted", source: "manual" }
          : kind === "worldedit"
            ? {
                kind: "we",
                world: "world",
                command: "//set stone",
                source: "manual",
              }
            : paste;
      await workspace.writeOplog({ version: 1, ops: [op] });
      for (const name of ["kept", "new"]) {
        await expect(
          renderBuild(env, workspace.dir, {
            source: "compiled",
            name,
            ...(look === "looks"
              ? { look: { views: ["sheet" as const] } }
              : {}),
          }),
        ).rejects.toThrow(/cannot render incomplete compiled evidence/u);
      }
      expect(await Promise.all(files.map((file) => file.bytes()))).toEqual(
        before,
      );
      expect(await Bun.file(workspace.file("renders/new.json")).exists()).toBe(
        false,
      );
      expect(await Bun.file(workspace.file("renders/new.png")).exists()).toBe(
        false,
      );
      expect(await readLog(workspace.dir)).toEqual(journal);
      const ask = vi.fn(() => Promise.reject(new Error("unexpected judge")));
      await expect(
        critiqueBuild(workspace.dir, {
          render: "new",
          rubric: "micro",
          model: "stub",
          stage: "visual",
          ask,
        }),
      ).rejects.toThrow();
      expect(ask).not.toHaveBeenCalled();
      expect(await readLog(workspace.dir)).toEqual(journal);
    },
  );
});

describe("frozen run provenance", () => {
  it("renders a frozen run without depending on a later compile snapshot", async () => {
    const workspace = await programBuild("expected-independent");
    await workspace.writeOplog({
      version: 1,
      ops: [{ kind: "command", command: "say later", source: "program:def" }],
    });
    const env = {
      client: new DaemonClient(),
      journal: new Journal(workspace.file("audit")),
      log: vi.fn(),
    };
    await renderBuild(env, workspace.dir, {
      source: "expected",
      name: "frozen",
    });
    expect(
      await Bun.file(workspace.file("renders/frozen.build.ts")).text(),
    ).toBe(await Bun.file(workspace.file(programSnapshot("abc"))).text());
    await expect(readRenderProvenance(workspace, "compiled")).rejects.toThrow(
      /missing producing program snapshot/u,
    );
    await expect(
      readRenderProvenance(workspace, "canvas", "sbx-000001"),
    ).rejects.toThrow(/missing producing program snapshot/u);
  });
});

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
    const resumed = await resumeState(workspace.dir);
    expect(resumed.latestRender).toBeNull();
    expect(resumed.journal).toEqual(journal);
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
    const current = await resumeState(workspace.dir);
    expect(current.latestRender?.name).toBe("current");
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
    const site = await readSchematic(
      await Bun.file(workspace.file(BUILD_FILES.siteSchematic)).bytes(),
    );
    await workspace.writeFrozen("expected", [
      {
        at: previous.min,
        bytes: writeSchematic(
          new BlockGrid(previous.size, "minecraft:stone"),
          site.dataVersion,
        ),
      },
    ]);
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
    const frozen = await readSchematic(
      await Bun.file(workspace.file(BUILD_FILES.expectedSchematic)).bytes(),
    );
    expect(frozen.grid.get(0, 0, 0)).toBe("minecraft:stone");
  });

  it("rejects missing producer snapshots before any sandbox or expected-state mutation", async () => {
    const workspace = await programBuild("run-missing-producer");
    await workspace.writeOplog({
      version: 1,
      ops: [
        { kind: "command", command: "say changed", source: "program:deadbeef" },
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

describe("candidate restore transactions", () => {
  it.each(
    [false, true].flatMap((program) =>
      [
        "missing-oplog",
        "invalid-oplog",
        "grid",
        "stage-write",
        "install",
        ...(program ? ["missing-program"] : []),
      ].map((failure) => ({ program, failure })),
    ),
  )(
    "preserves the working version on $failure with saved program $program",
    async ({ program, failure }) => {
      const workspace = await flatSiteBuild(
        path.join(temp, `pick-${program.toString()}-${failure}`),
        "pick",
      );
      await workspace.writeOplog({
        version: 1,
        ops: [
          {
            kind: "we",
            command: "//set air",
            world: "world",
            pos1: { x: 100, y: 64, z: 100 },
            pos2: { x: 100, y: 64, z: 100 },
            source: program ? "program:abc" : "manual",
          },
        ],
      });
      if (program)
        await Bun.write(
          workspace.file(programSnapshot("abc")),
          "saved program",
        );
      await saveCandidate(workspace.dir, "saved");
      await Bun.write(workspace.file(BUILD_FILES.program), "working program");
      await workspace.writeOplog({ version: 1, ops: [] });
      const working = [BUILD_FILES.program, BUILD_FILES.oplog].map((file) =>
        Bun.file(workspace.file(file)),
      );
      const before = await Promise.all(working.map((file) => file.bytes()));
      const journal = await readLog(workspace.dir);
      const saved = (file: string) =>
        workspace.file(`candidates/saved/${file}`);
      if (failure === "missing-oplog") await rm(saved(BUILD_FILES.oplog));
      if (failure === "invalid-oplog")
        await Bun.write(
          saved(BUILD_FILES.oplog),
          '{"version":1,"ops":[{"kind":"invalid"}]}',
        );
      if (failure === "grid")
        await Bun.write(saved("candidate.schem"), "corrupt grid");
      if (failure === "missing-program") await rm(saved(BUILD_FILES.program));
      const write =
        failure === "stage-write"
          ? vi
              .spyOn(Bun, "write")
              .mockRejectedValueOnce(new Error("simulated staging failure"))
          : null;
      restoreFailure.enabled = failure === "install";
      try {
        await expect(pickCandidate(workspace.dir, "saved")).rejects.toThrow();
      } finally {
        restoreFailure.enabled = false;
        write?.mockRestore();
      }
      expect(await Promise.all(working.map((file) => file.bytes()))).toEqual(
        before,
      );
      expect(await readLog(workspace.dir)).toEqual(journal);
      const names = await readdir(workspace.dir);
      expect(names.some((name) => name.startsWith(".pick-"))).toBe(false);
    },
  );
});

describe("candidate input validation", () => {
  it.each(["missing", "replaced"])(
    "rejects a %s referenced schematic before picking",
    async (failure) => {
      const workspace = await flatSiteBuild(
        path.join(temp, `pick-schematic-${failure}`),
        "pick",
      );
      const site = await readSchematic(
        await Bun.file(workspace.file(BUILD_FILES.siteSchematic)).bytes(),
      );
      const input = workspace.file("schematics/part.schem");
      const bytes = writeSchematic(
        new BlockGrid({ x: 2, y: 2, z: 2 }, "minecraft:stone"),
        site.dataVersion,
      );
      await Bun.write(input, bytes);
      const ops: Op[] = [
        {
          kind: "paste",
          schematic: "schematics/part.schem",
          world: "world",
          at: { x: 100, y: 64, z: 100 },
          rotate: 0,
          ignoreAir: false,
          source: "manual",
        },
      ];
      await workspace.writeOplog({ version: 1, ops });
      await saveCandidate(workspace.dir, "saved");
      await workspace.writeOplog({ version: 1, ops: [] });
      await Bun.write(workspace.file(BUILD_FILES.program), "working program");
      const before = await Bun.file(workspace.file(BUILD_FILES.oplog)).bytes();
      const journal = await readLog(workspace.dir);
      if (failure === "missing") await rm(input);
      else
        await Bun.write(
          input,
          writeSchematic(
            new BlockGrid({ x: 2, y: 2, z: 2 }, "minecraft:dirt"),
            site.dataVersion,
          ),
        );
      await expect(pickCandidate(workspace.dir, "saved")).rejects.toThrow();
      expect(await Bun.file(workspace.file(BUILD_FILES.program)).text()).toBe(
        "working program",
      );
      expect(await Bun.file(workspace.file(BUILD_FILES.oplog)).bytes()).toEqual(
        before,
      );
      expect(await readLog(workspace.dir)).toEqual(journal);
      await Bun.write(input, bytes);
      await pickCandidate(workspace.dir, "saved");
      const restored = await workspace.oplog();
      expect(restored.ops).toEqual(ops);
    },
  );
});

describe("tournament restoration preflight", () => {
  it.each(
    ["a", "c"].flatMap((candidate) =>
      [
        "missing-oplog",
        "invalid-oplog",
        "missing-program",
        "program-bytes",
        "input",
      ].map((failure) => ({ candidate, failure })),
    ),
  )(
    "rejects $candidate with $failure before any bout",
    async ({ candidate, failure }) => {
      const workspace = await flatSiteBuild(
        path.join(temp, `restore-${candidate}-${failure}`),
        "restore",
      );
      const source = "program:abc";
      await Bun.write(workspace.file(programSnapshot("abc")), "saved program");
      const site = await readSchematic(
        await Bun.file(workspace.file(BUILD_FILES.siteSchematic)).bytes(),
      );
      await Bun.write(
        workspace.file("schematics/input.schem"),
        writeSchematic(
          new BlockGrid({ x: 1, y: 1, z: 1 }, "minecraft:stone"),
          site.dataVersion,
        ),
      );
      await workspace.writeOplog({
        version: 1,
        ops: [
          {
            kind: "paste",
            schematic: "schematics/input.schem",
            world: "world",
            at: { x: 100, y: 65, z: 100 },
            rotate: 0,
            ignoreAir: false,
            source,
          },
        ],
      });
      for (const name of ["a", "b", "c"])
        await saveCandidate(workspace.dir, name);
      await workspace.writeOplog({ version: 1, ops: [] });
      await Bun.write(workspace.file(BUILD_FILES.program), "working program");
      const manifest = await workspace.manifest();
      const journal = await readLog(workspace.dir);
      const working = await Bun.file(
        workspace.file(BUILD_FILES.program),
      ).bytes();
      const opBytes = await Bun.file(workspace.file(BUILD_FILES.oplog)).bytes();
      const saved = (file: string) =>
        workspace.file(`candidates/${candidate}/${file}`);
      switch (failure) {
        case "missing-oplog":
          await rm(saved(BUILD_FILES.oplog));
          break;
        case "invalid-oplog":
          await Bun.write(saved(BUILD_FILES.oplog), "corrupt");
          break;
        case "missing-program":
          await rm(saved(BUILD_FILES.program));
          break;
        case "program-bytes":
          await Bun.write(saved(BUILD_FILES.program), "replaced program");
          break;
        case "input":
          await rm(workspace.file("schematics/input.schem"));
          break;
        default:
          throw new Error("unknown fixture");
      }
      const ask = vi.fn(() => Promise.reject(new Error("unexpected judge")));
      await expect(
        knockout(workspace.dir, {
          among: ["a", "b", "c"],
          rubric: "micro",
          model: "stub",
          ask,
        }),
      ).rejects.toThrow();
      expect(ask).not.toHaveBeenCalled();
      expect(await workspace.manifest()).toEqual(manifest);
      expect(await readLog(workspace.dir)).toEqual(journal);
      expect(
        await Bun.file(workspace.file(BUILD_FILES.program)).bytes(),
      ).toEqual(working);
      expect(await Bun.file(workspace.file(BUILD_FILES.oplog)).bytes()).toEqual(
        opBytes,
      );
      expect(await readdir(workspace.dir)).not.toContain("judge");
    },
  );
});

describe("tournament score preflight", () => {
  it.each(
    ["a", "c"].flatMap((candidate) =>
      [
        "record",
        "image",
        "corrupt",
        "total",
        "max",
        "lowest",
        "missing-axis",
        "extra-axis",
      ].map((failure) => ({ candidate, failure })),
    ),
  )(
    "rejects $failure evidence for $candidate before any bout",
    async ({ candidate, failure }) => {
      const workspace = await flatSiteBuild(
        path.join(temp, `score-${candidate}-${failure}`),
        "score",
      );
      const env = {
        client: new DaemonClient(),
        journal: new Journal(workspace.file("audit")),
        log: vi.fn(),
      };
      let record = "";
      let sheet = "";
      for (const [index, name] of ["a", "b", "c"].entries()) {
        await workspace.writeOplog({
          version: 1,
          ops: [clearFloorOp(index)],
        });
        await saveCandidate(workspace.dir, name);
        if (name === candidate) {
          await renderBuild(env, workspace.dir, { source: "compiled", name });
          const critique = await critiqueBuild(workspace.dir, {
            render: name,
            rubric: "micro",
            model: "stub",
            stage: "visual",
            byEye: {
              axes: Object.fromEntries(
                rubricAxisIds("micro").map((axis) => [axis, 3]),
              ),
              overallAesthetic: 3,
              notes: [],
            },
          });
          record = workspace.file(critique.record);
          sheet = workspace.file(critique.sheet);
        }
      }
      if (record === "" || sheet === "")
        throw new Error("missing fixture evidence");
      if (failure === "record") await rm(record);
      if (failure === "image") await rm(sheet);
      if (failure === "corrupt") {
        const content = JudgeCritiqueRecordSchema.parse(
          await Bun.file(record).json(),
        );
        await Bun.write(
          record,
          JSON.stringify({ ...content, total: content.total + 1 }),
        );
      }
      if (
        ["total", "max", "lowest", "missing-axis", "extra-axis"].includes(
          failure,
        )
      ) {
        await corruptCritiqueScores(workspace, record, failure);
      }
      const journal = await readLog(workspace.dir);
      const manifest = await Bun.file(
        workspace.file(BUILD_FILES.manifest),
      ).bytes();
      const files = await readdir(workspace.file(BUILD_FILES.judgeDir));
      const ask = vi.fn(() =>
        Promise.reject(new Error("unexpected judge call")),
      );
      await expect(
        knockout(workspace.dir, {
          among: ["a", "b", "c"],
          rubric: "micro",
          model: "stub",
          ask,
        }),
      ).rejects.toThrow();
      expect(ask).not.toHaveBeenCalled();
      expect(await readLog(workspace.dir)).toEqual(journal);
      expect(
        await Bun.file(workspace.file(BUILD_FILES.manifest)).bytes(),
      ).toEqual(manifest);
      expect(await readdir(workspace.file(BUILD_FILES.judgeDir))).toEqual(
        files,
      );
      expect(await readJournal(workspace.dir)).toHaveProperty("error");
    },
  );
});

describe("reused critique identity", () => {
  it.each(["traversal", "absolute", "symlink", "other"] as const)(
    "rejects %s run program paths before replacing render evidence",
    async (kind) => {
      const workspace = await programBuild(`journal-${kind}`);
      const grid = new BlockGrid({ x: 2, y: 2, z: 2 }, "minecraft:stone");
      await renderLooks(workspace, grid, "look", {
        source: "compiled",
        views: ["sheet"],
      });
      const files = [
        "renders/look.png",
        "renders/look.json",
        "renders/look.build.ts",
      ];
      const before = await Promise.all(
        files.map((file) => Bun.file(workspace.file(file)).bytes()),
      );
      const outside = path.join(temp, `outside-${kind}.ts`);
      await Bun.write(outside, "private fixture outside build");
      const program =
        kind === "traversal"
          ? path.relative(workspace.dir, outside)
          : kind === "absolute"
            ? outside
            : kind === "other"
              ? "renders/look.build.ts"
              : programSnapshot("abc");
      if (kind === "symlink") {
        await rm(workspace.file(program));
        await symlink(outside, workspace.file(program));
      }
      await appendLog(workspace.dir, {
        kind: "run",
        target: "sbx-000001",
        ops: 1,
        program,
      });
      const journal = await readLog(workspace.dir);
      await expect(
        renderLooks(workspace, grid, "look", {
          source: "expected",
          views: ["sheet"],
        }),
      ).rejects.toThrow(
        /invalid producing program snapshot path|outside its build/u,
      );
      expect(await readLog(workspace.dir)).toEqual(journal);
      expect(
        await Promise.all(
          files.map((file) => Bun.file(workspace.file(file)).bytes()),
        ),
      ).toEqual(before);
    },
    60_000,
  );

  it("rejects a render program symlink outside the build before model calls", async () => {
    const workspace = await programBuild("render-program-link");
    await renderLooks(
      workspace,
      new BlockGrid({ x: 2, y: 2, z: 2 }, "minecraft:stone"),
      "look",
      { source: "compiled", views: ["sheet"] },
    );
    const outside = path.join(temp, "outside-render.ts");
    await Bun.write(outside, "private fixture outside build");
    const program = workspace.file("renders/look.build.ts");
    await rm(program);
    await symlink(outside, program);
    const journal = await readLog(workspace.dir);
    const ask = vi.fn(() =>
      Promise.reject(new Error("unexpected visual call")),
    );
    const askCode = vi.fn(() => Promise.resolve({ suggestions: [] }));
    await expect(
      critiqueBuild(workspace.dir, {
        render: "look",
        rubric: "micro",
        model: "stub",
        stage: "both",
        ask,
        askCode,
      }),
    ).rejects.toThrow(/outside its build/u);
    expect(ask).not.toHaveBeenCalled();
    expect(askCode).not.toHaveBeenCalled();
    expect(await readLog(workspace.dir)).toEqual(journal);
  }, 60_000);

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
