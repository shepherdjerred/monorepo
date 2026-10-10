import { cp, mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import type * as FileSystem from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  flatSiteBuild,
  clearFloorOp,
  regionForGrid,
} from "#test/fixtures/flat-site.ts";
import {
  renderBuild,
  captureSite,
  compileBuild,
  runBuild,
  createCanvas,
} from "#build/commands.ts";
import { withPublicationLock } from "#protocol/publication-lock.ts";
import { promoteBuild } from "#build/apply.ts";
import { critiqueBuild } from "#build/studio/critique.ts";
import { saveCandidate, pickCandidate } from "#build/studio/candidates.ts";
import { readJournal } from "#evals/grade/trajectory.ts";
import { appendLog, readLog } from "#build/build-log.ts";
import { BlockGrid } from "@shepherdjerred/mc-build/core/grid.ts";
import { writeSchematic } from "@shepherdjerred/mc-build/core/schem.ts";
import { loadRegistry } from "@shepherdjerred/mc-build/registry/registry.ts";
import { writeProgramFixture } from "#test/fixtures/program-evidence.ts";
import { rubricAxisIds } from "#build/judge.ts";
import { DaemonClient } from "#build/daemon-client.ts";
import { Journal } from "#build/journal.ts";
import { BUILD_FILES, JudgeCritiqueRecordSchema } from "#protocol/build.ts";

const failure = vi.hoisted(() => ({
  kind: "",
  install: "",
  preparation: false,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof FileSystem>();
  return {
    ...original,
    appendFile: async (...args: Parameters<typeof original.appendFile>) => {
      if (
        failure.kind !== "" &&
        typeof args[1] === "string" &&
        args[1].includes(`"kind":"${failure.kind}"`)
      ) {
        failure.kind = "";
        throw new Error("simulated evidence journal failure");
      }
      return original.appendFile(...args);
    },
    rename: async (...args: Parameters<typeof original.rename>) => {
      const from = String(args[0]);
      if (failure.preparation && from.endsWith("/.prepared.pending")) {
        failure.preparation = false;
        throw new Error("simulated preparation marker failure");
      }
      if (
        failure.install !== "" &&
        (from.includes(".capture-") ||
          from.includes(".pick-") ||
          from.includes(".compile-") ||
          from.includes(".render-") ||
          from.includes(".critique-publish-")) &&
        from.endsWith(failure.install)
      ) {
        failure.install = "";
        throw new Error("simulated evidence install failure");
      }
      return original.rename(...args);
    },
  };
});
vi.mock("@shepherdjerred/mc-build/render/assets.ts", async () => {
  const { renderAssets } = await import("#test/fixtures/render-assets.ts");
  return { ensureAssets: renderAssets };
});
const root = await mkdtemp(path.join(os.tmpdir(), "mc-evidence-publication-"));
afterAll(async () => rm(root, { recursive: true }));

async function fixture(name: string) {
  const workspace = await flatSiteBuild(path.join(root, name), name);
  await workspace.writeOplog({
    version: 1,
    ops: [{ ...clearFloorOp(1), source: "program:abcd" }],
  });
  await writeProgramFixture(workspace, "abcd", "// producing program\n");
  const env = {
    client: new DaemonClient(),
    journal: new Journal(workspace.file("audit")),
    log: vi.fn(),
  };
  return { workspace, env };
}

async function captureFixture(name: string) {
  const { workspace, env } = await fixture(name);
  const box = workspace.siteBox(await workspace.manifest());
  const original = await workspace.siteGrid();
  let current = original;
  const { dataVersion } = await loadRegistry();
  const region = () => regionForGrid(current, box.min);
  vi.spyOn(env.client, "snapshotParts").mockResolvedValue({
    id: "capture",
    parts: [{ id: "capture", box }],
  });
  vi.spyOn(env.client, "snapshotBytes").mockImplementation(() =>
    Promise.resolve(writeSchematic(current, dataVersion)),
  );
  vi.spyOn(env.client, "regionRead").mockImplementation(() =>
    Promise.resolve(region()),
  );
  return {
    workspace,
    env,
    box,
    original,
    region,
    dataVersion,
    setGrid: (grid: BlockGrid) => {
      current = grid;
    },
  };
}

async function evidence(dir: string) {
  const files = await readdir(dir, { recursive: true, withFileTypes: true });
  const result: Record<string, Uint8Array> = {};
  for (const entry of files) {
    const relative = path.relative(
      dir,
      path.join(entry.parentPath, entry.name),
    );
    if (
      entry.isFile() &&
      (relative.startsWith("renders/") ||
        relative.startsWith("judge/") ||
        relative.startsWith("site/") ||
        relative.startsWith("schematics/") ||
        relative === BUILD_FILES.oplog ||
        relative === BUILD_FILES.manifest ||
        relative === BUILD_FILES.journal)
    )
      result[relative] = await Bun.file(path.join(dir, relative)).bytes();
  }
  return result;
}

const compileSource = (block: string) =>
  `export default (ctx) => { ctx.set(1, 1, 1, "minecraft:${block}"); };\n`;

describe("compile evidence publication", () => {
  it.each(["journal", "journal-install", "oplog", "snapshot", "malformed"])(
    "preserves the active compile and journal after %s failure",
    async (mode) => {
      const { workspace } = await fixture(`compile-${mode}`);
      await Bun.write(
        workspace.file(BUILD_FILES.program),
        compileSource("stone"),
      );
      await compileBuild(workspace.dir);
      const oldLog = await workspace.oplog();
      const cleanJournal = await Bun.file(
        workspace.file(BUILD_FILES.journal),
      ).text();
      await Bun.write(
        workspace.file(BUILD_FILES.program),
        compileSource("oak_planks"),
      );
      if (mode === "malformed")
        await Bun.write(
          workspace.file(BUILD_FILES.journal),
          "invalid journal\n",
        );
      else if (mode === "journal") failure.kind = "compile";
      else
        failure.install =
          mode === "journal-install"
            ? BUILD_FILES.journal
            : mode === "oplog"
              ? BUILD_FILES.oplog
              : ".schem";
      const before = await evidence(workspace.dir);
      await expect(compileBuild(workspace.dir)).rejects.toThrow();
      expect(await evidence(workspace.dir)).toEqual(before);
      const files = await readdir(workspace.dir);
      expect(files.some((file) => file.startsWith(".compile-"))).toBe(false);
      if (mode === "malformed")
        await Bun.write(workspace.file(BUILD_FILES.journal), cleanJournal);
      await compileBuild(workspace.dir);
      expect(await workspace.oplog()).not.toEqual(oldLog);
      const journal = await readLog(workspace.dir);
      expect(journal.filter((entry) => entry.kind === "compile")).toHaveLength(
        2,
      );
    },
  );
});

describe("capture evidence publication", () => {
  it.each(["journal", "install"])(
    "restores a same-box recapture on %s failure and invalidates old expected results on success",
    async (mode) => {
      const { workspace, env, box, original, region, dataVersion, setGrid } =
        await captureFixture(`recapture-${mode}`);
      await captureSite(env, workspace.dir, { target: "sbx-000001", box });
      await workspace.writeExpected(region());
      await workspace.writeFrozen("expected", [
        { at: box.min, bytes: writeSchematic(original, dataVersion) },
      ]);
      await appendLog(workspace.dir, {
        kind: "run",
        target: "sbx-000001",
        ops: 0,
        program: null,
      });
      const before = await evidence(workspace.dir);
      setGrid(new BlockGrid(original.size, "minecraft:stone"));
      if (mode === "journal") failure.kind = "capture";
      else failure.install = BUILD_FILES.manifest;
      await expect(
        captureSite(env, workspace.dir, { target: "sbx-000001", box }),
      ).rejects.toThrow(/evidence (journal|install) failure/u);
      expect(await evidence(workspace.dir)).toEqual(before);
      const restored = await workspace.expected();
      expect(restored.diff(original).count).toBe(0);
      await captureSite(env, workspace.dir, { target: "sbx-000001", box });
      await expect(workspace.expected()).rejects.toThrow(/current capture/u);
      await expect(
        renderBuild(env, workspace.dir, { source: "expected" }),
      ).rejects.toThrow(/current capture/u);
      await expect(
        promoteBuild(env, workspace.dir, { target: "sbx-000001" }),
      ).rejects.toThrow(/current capture/u);
      const journal = await readLog(workspace.dir);
      expect(journal.filter((entry) => entry.kind === "capture")).toHaveLength(
        2,
      );
    },
  );
});

describe("capture interruption identity", () => {
  it.each(
    [
      "journal",
      "site",
      "missing",
      "corrupt",
      "legacy",
      "payload",
      "info",
      "extra",
    ].flatMap((phase) => [false, true].map((changed) => ({ phase, changed }))),
  )(
    "rejects interrupted $phase capture (changed grid: $changed) and permits explicit recapture",
    async ({ phase, changed }) => {
      const { workspace, env, box, original, setGrid } = await captureFixture(
        `capture-${phase}-${String(changed)}`,
      );
      await captureSite(env, workspace.dir, { target: "sbx-000001", box });
      const oldManifest = await Bun.file(
        workspace.file(BUILD_FILES.manifest),
      ).bytes();
      const backup = path.join(root, `backup-${phase}-${String(changed)}`);
      await cp(workspace.file(BUILD_FILES.siteDir), backup, {
        recursive: true,
      });
      if (changed) setGrid(new BlockGrid(original.size, "minecraft:stone"));
      await captureSite(env, workspace.dir, { target: "sbx-000001", box });
      const complete = await workspace.manifest();
      if (phase === "journal") {
        await rm(workspace.file(BUILD_FILES.siteDir), { recursive: true });
        await cp(backup, workspace.file(BUILD_FILES.siteDir), {
          recursive: true,
        });
      }
      switch (phase) {
        case "journal":
        case "site":
          await Bun.write(workspace.file(BUILD_FILES.manifest), oldManifest);
          break;
        case "missing":
          await rm(workspace.file(BUILD_FILES.siteIdentity));
          break;
        case "corrupt":
          await Bun.write(
            workspace.file(BUILD_FILES.siteIdentity),
            "invalid identity",
          );
          break;
        case "payload":
          await Bun.write(
            workspace.file(BUILD_FILES.siteSchematic),
            "damaged snapshot",
          );
          break;
        case "info":
          await Bun.write(
            workspace.file(BUILD_FILES.siteInfo),
            "damaged metadata",
          );
          break;
        case "extra":
          await Bun.write(
            workspace.file("site/extra.schem"),
            "unexpected tile",
          );
          break;
        default: {
          const entries = await readLog(workspace.dir);
          await Bun.write(
            workspace.file(BUILD_FILES.journal),
            entries
              .map((entry) => {
                if (entry.kind !== "capture") return JSON.stringify(entry);
                const { id: _id, ...legacy } = entry;
                return JSON.stringify(legacy);
              })
              .join("\n") + "\n",
          );
        }
      }
      const we = vi.spyOn(env.client, "we");
      const paste = vi.spyOn(env.client, "paste");
      for (const read of [
        () => workspace.manifest(),
        () => workspace.siteGrid(),
        () => workspace.siteInfo(),
        () => workspace.frozenParts("site", box),
        () => compileBuild(workspace.dir),
        () =>
          renderBuild(env, workspace.dir, {
            source: "compiled",
            name: "invalid",
          }),
        () => runBuild(env, workspace.dir, { target: "sbx-000001" }),
        () => saveCandidate(workspace.dir, "invalid"),
        () => promoteBuild(env, workspace.dir, { target: "sbx-000001" }),
      ])
        await expect(read()).rejects.toThrow();
      expect(we).not.toHaveBeenCalled();
      expect(paste).not.toHaveBeenCalled();
      expect(
        await Bun.file(workspace.file("renders/invalid.json")).exists(),
      ).toBe(false);
      await captureSite(env, workspace.dir, { target: "sbx-000001", box });
      const repaired = await workspace.manifest();
      expect(repaired.site?.id).not.toBe(complete.site?.id);
      expect(repaired.site?.siteHash).toBe(complete.site?.siteHash);
      expect(await workspace.siteGrid()).toMatchObject({ size: original.size });
    },
  );
});

describe("run publication lock", () => {
  it("excludes recorded edits and snapshots throughout replay and releases on success and failure", async () => {
    const { workspace, env, box, region, original, dataVersion } =
      await captureFixture("run-locked");
    const locked = async () => {
      await expect(
        withPublicationLock(workspace.dir, () => Promise.resolve()),
      ).rejects.toThrow(/already running/u);
      await expect(
        appendLog(workspace.dir, { kind: "note", text: "concurrent edit" }),
      ).rejects.toThrow(/already running/u);
      await expect(createCanvas(env, workspace.dir, {})).rejects.toThrow(
        /already running/u,
      );
    };
    const we = vi.spyOn(env.client, "we").mockImplementation(async () => {
      await locked();
      return { results: [], historySize: 0 };
    });
    vi.spyOn(env.client, "paste").mockImplementation(async () => {
      await locked();
      return { changed: 0, min: box.min, max: box.max, historySize: 0 };
    });
    vi.spyOn(env.client, "snapshotParts").mockImplementation(async () => {
      await locked();
      return { id: "run", parts: [{ id: "run", box }] };
    });
    vi.spyOn(env.client, "snapshotBytes").mockImplementation(async () => {
      await locked();
      return writeSchematic(original, dataVersion);
    });
    vi.spyOn(env.client, "regionRead").mockImplementation(async () => {
      await locked();
      return region();
    });
    await captureSite(env, workspace.dir, { target: "sbx-000001", box });
    await runBuild(env, workspace.dir, { target: "sbx-000001" });
    const before = await readLog(workspace.dir);
    expect(before.filter((entry) => entry.kind === "run")).toHaveLength(1);
    await withPublicationLock(workspace.dir, () => Promise.resolve());
    we.mockRejectedValueOnce(new Error("simulated replay failure"));
    await expect(
      runBuild(env, workspace.dir, { target: "sbx-000001" }),
    ).rejects.toThrow(/replay failure/u);
    expect(await readLog(workspace.dir)).toEqual(before);
    await withPublicationLock(workspace.dir, () => Promise.resolve());
  });
});

describe("candidate selection publication", () => {
  it.each(["malformed", "journal", "install"])(
    "preserves the working files on %s journal failure",
    async (mode) => {
      const { workspace } = await fixture(`pick-journal-${mode}`);
      await saveCandidate(workspace.dir, "saved");
      await workspace.writeOplog({ version: 1, ops: [clearFloorOp(2)] });
      await Bun.write(
        workspace.file(BUILD_FILES.program),
        "// working program\n",
      );
      const working = [BUILD_FILES.program, BUILD_FILES.oplog].map((file) =>
        Bun.file(workspace.file(file)),
      );
      const before = await Promise.all(working.map((file) => file.bytes()));
      const original = await Bun.file(
        workspace.file(BUILD_FILES.journal),
      ).text();
      if (mode === "malformed")
        await Bun.write(workspace.file(BUILD_FILES.journal), "malformed\n");
      else if (mode === "journal") failure.kind = "candidate";
      else failure.install = BUILD_FILES.journal;
      const journal = await Bun.file(
        workspace.file(BUILD_FILES.journal),
      ).text();
      await expect(pickCandidate(workspace.dir, "saved")).rejects.toThrow();
      expect(await Promise.all(working.map((file) => file.bytes()))).toEqual(
        before,
      );
      expect(await Bun.file(workspace.file(BUILD_FILES.journal)).text()).toBe(
        journal,
      );
      await Bun.write(workspace.file(BUILD_FILES.journal), original);
      await pickCandidate(workspace.dir, "saved");
      const completed = await readLog(workspace.dir);
      expect(
        completed.filter(
          (entry) => entry.kind === "candidate" && entry.action === "pick",
        ),
      ).toHaveLength(1);
    },
  );
});

describe("render evidence publication", () => {
  it.each(["plain", "regional"])(
    "preserves reused %s render evidence when journal staging fails",
    async (kind) => {
      const { workspace, env } = await fixture(`render-${kind}`);
      const options = {
        name: "inspect",
        source: "compiled" as const,
        ...(kind === "regional"
          ? {
              region: {
                min: { x: 100, y: 64, z: 100 },
                max: { x: 104, y: 73, z: 109 },
              },
              look: { mode: "relief" as const },
            }
          : {}),
      };
      await renderBuild(env, workspace.dir, options);
      await critiqueBuild(workspace.dir, {
        render: "inspect",
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
      await workspace.writeOplog({ version: 1, ops: [clearFloorOp(2)] });
      const before = await evidence(workspace.dir);
      failure.kind = "render";
      await expect(renderBuild(env, workspace.dir, options)).rejects.toThrow(
        /journal failure/u,
      );
      expect(await evidence(workspace.dir)).toEqual(before);
      expect(await readJournal(workspace.dir)).toHaveProperty("entries");
      failure.install = "renders/inspect.json";
      await expect(renderBuild(env, workspace.dir, options)).rejects.toThrow(
        /install failure/u,
      );
      expect(await evidence(workspace.dir)).toEqual(before);
      const result = await renderBuild(env, workspace.dir, options);
      expect(result.render).toBe(workspace.file("renders/inspect.png"));
      expect(await evidence(workspace.dir)).not.toEqual(before);
    },
  );
});

describe("markerless critique preparation", () => {
  it.each([
    "valid",
    "record",
    "sheet",
    "grid",
    "missing-record",
    "ambiguous",
    "escape",
  ])("recovers only complete markerless critique bundles: %s", async (mode) => {
    const { workspace, env } = await fixture(`markerless-${mode}`);
    await renderBuild(env, workspace.dir, {
      name: "inspect",
      source: "compiled",
    });
    const ask = vi.fn(() =>
      Promise.resolve({
        axes: Object.fromEntries(
          rubricAxisIds("micro").map((axis) => [axis, 4]),
        ),
        overallAesthetic: 4,
        notes: [],
      }),
    );
    const askCode = vi.fn(() =>
      Promise.resolve({
        suggestions: [{ axis: "mass", change: "add a window", where: "wall" }],
      }),
    );
    const options = {
      render: "inspect",
      rubric: "micro" as const,
      model: "stub",
      stage: "both" as const,
      ask,
      askCode,
    };
    failure.preparation = true;
    await expect(critiqueBuild(workspace.dir, options)).rejects.toThrow(
      /preparation marker failure/u,
    );
    const names = await readdir(workspace.dir);
    const bundle = names.find((name) =>
      /^\.critique-[a-f0-9]{64}$/u.test(name),
    );
    if (bundle === undefined) throw new Error("missing critique bundle");
    const dir = workspace.file(bundle);
    const pending = await Bun.file(path.join(dir, ".prepared.pending")).json();
    const manifest = z
      .object({ record: z.string(), verdict: JudgeCritiqueRecordSchema })
      .parse(pending);
    await rm(path.join(dir, "renders/inspect.json"));
    await Bun.write(
      path.join(dir, ".prepared.pending"),
      "interrupted metadata",
    );
    switch (mode) {
      case "record":
        await Bun.write(
          path.join(dir, manifest.record),
          JSON.stringify({ ...manifest.verdict, model: "changed" }),
        );
        break;
      case "sheet":
        await Bun.write(
          path.join(dir, manifest.verdict.sheet),
          "damaged sheet",
        );
        break;
      case "grid":
        await Bun.write(path.join(dir, manifest.verdict.grid), "damaged grid");
        break;
      case "missing-record":
        await rm(path.join(dir, manifest.record));
        break;
      case "ambiguous":
        await cp(
          path.join(dir, manifest.record),
          path.join(dir, "judge/extra.json"),
        );
        break;
      case "escape": {
        const outside = path.join(root, "outside-preparation");
        await cp(dir, outside, { recursive: true });
        await rm(dir, { recursive: true });
        await symlink(outside, dir, "dir");
        break;
      }
    }
    if (mode === "valid") {
      const result = await critiqueBuild(workspace.dir, options);
      expect(result.scores.total).toBe(32);
      expect(result.reviewedProgram).toBe(true);
    } else {
      await expect(critiqueBuild(workspace.dir, options)).rejects.toThrow();
    }
    const journal = await readLog(workspace.dir);
    expect(journal.filter((entry) => entry.kind === "critique")).toHaveLength(
      mode === "valid" ? 1 : 0,
    );
    if (mode === "escape")
      expect(
        await Bun.file(path.join(dir, "renders/inspect.json")).exists(),
      ).toBe(false);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(askCode).toHaveBeenCalledTimes(1);
  });
});

describe("critique evidence publication", () => {
  it.each([
    ["visual", false],
    ["visual", true],
    ["both", false],
    ["both", true],
  ] as const)(
    "preserves a newer same-name render during %s critique (changed grid: %s)",
    async (stage, changed) => {
      const { workspace, env } = await fixture(
        `stale-${stage}-${String(changed)}`,
      );
      await renderBuild(env, workspace.dir, {
        name: "inspect",
        source: "compiled",
      });
      let current: Awaited<ReturnType<typeof evidence>> | undefined;
      const ask = vi.fn(async () => {
        if (changed)
          await workspace.writeOplog({ version: 1, ops: [clearFloorOp(2)] });
        await renderBuild(env, workspace.dir, {
          name: "inspect",
          source: "compiled",
        });
        current = await evidence(workspace.dir);
        return {
          axes: Object.fromEntries(
            rubricAxisIds("micro").map((axis) => [axis, 4]),
          ),
          overallAesthetic: 4,
          notes: [],
        };
      });
      const askCode = vi.fn(() => Promise.resolve({ suggestions: [] }));
      await expect(
        critiqueBuild(workspace.dir, {
          render: "inspect",
          rubric: "micro",
          model: "stub",
          stage,
          ask,
          askCode,
        }),
      ).rejects.toThrow(/changed during critique/u);
      expect(current).toBeDefined();
      expect(await evidence(workspace.dir)).toEqual(current);
      const journal = await readLog(workspace.dir);
      expect(journal.filter((entry) => entry.kind === "critique")).toEqual([]);
      expect(journal.filter((entry) => entry.kind === "render")).toHaveLength(
        2,
      );
      expect(ask).toHaveBeenCalledTimes(1);
      expect(askCode).toHaveBeenCalledTimes(stage === "both" ? 1 : 0);
      const pendingDirs = await readdir(workspace.dir);
      expect(
        pendingDirs.filter((name) => /^\.critique-[a-f0-9]{64}$/u.test(name)),
      ).toHaveLength(1);
    },
  );

  it.each(["journal", "install"])(
    "reuses both paid results after %s publication failure",
    async (mode) => {
      const { workspace, env } = await fixture(`critique-${mode}`);
      await renderBuild(env, workspace.dir, {
        name: "inspect",
        source: "compiled",
      });
      const before = await evidence(workspace.dir);
      const ask = vi.fn(() =>
        Promise.resolve({
          axes: Object.fromEntries(
            rubricAxisIds("micro").map((axis) => [axis, 4]),
          ),
          overallAesthetic: 4,
          notes: ["fixture"],
        }),
      );
      const askCode = vi.fn(() =>
        Promise.resolve({
          suggestions: [
            {
              axis: rubricAxisIds("micro")[0] ?? "mass",
              change: "add a window",
              where: "wall",
            },
          ],
        }),
      );
      const options = {
        render: "inspect",
        rubric: "micro" as const,
        model: "stub",
        stage: "both" as const,
        ask,
        askCode,
      };
      if (mode === "journal") failure.kind = "critique";
      else failure.install = "renders/inspect.json";
      await expect(critiqueBuild(workspace.dir, options)).rejects.toThrow(
        /evidence (journal|install) failure/u,
      );
      expect(ask).toHaveBeenCalledTimes(1);
      expect(askCode).toHaveBeenCalledTimes(1);
      expect(await evidence(workspace.dir)).toEqual(before);
      const names = await readdir(workspace.dir);
      const bundle = names.find((name) =>
        /^\.critique-[a-f0-9]{64}$/u.test(name),
      );
      if (bundle === undefined) throw new Error("missing prepared critique");
      const backup = path.join(root, `prepared-${mode}`);
      await cp(workspace.file(bundle), backup, { recursive: true });
      const retry = await critiqueBuild(workspace.dir, options);
      expect(retry.scores.total).toBe(32);
      expect(retry.reviewedProgram).toBe(true);
      expect(ask).toHaveBeenCalledTimes(1);
      expect(askCode).toHaveBeenCalledTimes(1);
      const journal = await readLog(workspace.dir);
      expect(journal.filter((entry) => entry.kind === "critique")).toHaveLength(
        1,
      );
      expect(await readJournal(workspace.dir)).toHaveProperty("entries");
      // A process exit after journal installation but before bundle cleanup also retries once.
      await cp(backup, workspace.file(bundle), { recursive: true });
      await critiqueBuild(workspace.dir, options);
      expect(await readLog(workspace.dir)).toEqual(journal);
      expect(ask).toHaveBeenCalledTimes(1);
      expect(askCode).toHaveBeenCalledTimes(1);
      const code = await critiqueBuild(workspace.dir, {
        ...options,
        stage: "code",
      });

      expect(code.scores.total).toBe(32);
      expect(ask).toHaveBeenCalledTimes(1);
      expect(askCode).toHaveBeenCalledTimes(2);
    },
  );
  it("rejects damaged prepared evidence before asking a model again", async () => {
    const { workspace, env } = await fixture("critique-corrupt-prepared");
    await renderBuild(env, workspace.dir, {
      name: "inspect",
      source: "compiled",
    });
    const ask = vi.fn(() =>
      Promise.resolve({
        axes: Object.fromEntries(
          rubricAxisIds("micro").map((axis) => [axis, 3]),
        ),
        overallAesthetic: 3,
        notes: [],
      }),
    );
    const options = {
      render: "inspect",
      rubric: "micro" as const,
      model: "stub",
      stage: "visual" as const,
      ask,
    };
    failure.kind = "critique";
    await expect(critiqueBuild(workspace.dir, options)).rejects.toThrow(
      /journal failure/u,
    );
    const names = await readdir(workspace.dir);
    const bundle = names.find((name) =>
      /^\.critique-[a-f0-9]{64}$/u.test(name),
    );
    if (bundle === undefined) throw new Error("missing prepared critique");
    const files = await readdir(workspace.file(`${bundle}/judge`));
    const png = files.find((file) => file.endsWith(".png"));
    if (png === undefined) throw new Error("missing prepared sheet");
    await Bun.write(workspace.file(`${bundle}/judge/${png}`), "truncated");
    await expect(critiqueBuild(workspace.dir, options)).rejects.toThrow(
      /hash/u,
    );
    expect(ask).toHaveBeenCalledTimes(1);
  });
});
