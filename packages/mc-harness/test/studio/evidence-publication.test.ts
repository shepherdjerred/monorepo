import { cp, mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import type * as FileSystem from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { flatSiteBuild, clearFloorOp } from "#test/fixtures/flat-site.ts";
import { renderBuild, captureSite } from "#build/commands.ts";
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
        relative === BUILD_FILES.manifest ||
        relative === BUILD_FILES.journal)
    )
      result[relative] = await Bun.file(path.join(dir, relative)).bytes();
  }
  return result;
}

describe("capture evidence publication", () => {
  it.each(["journal", "install"])(
    "restores a same-box recapture on %s failure and invalidates old expected results on success",
    async (mode) => {
      const { workspace, env } = await fixture(`recapture-${mode}`);
      const manifest = await workspace.manifest();
      const box = workspace.siteBox(manifest);
      const original = await workspace.siteGrid();
      let current = original;
      const registry = await loadRegistry();
      const region = () => {
        const blocks = Buffer.alloc(current.volume * 4);
        current.data.forEach((state, index) =>
          blocks.writeUInt32LE(state, index * 4),
        );
        return {
          ...box,
          size: current.size,
          palette: current.palette,
          blocks: blocks.toString("base64"),
          blockEntities: [],
        };
      };
      vi.spyOn(env.client, "snapshotParts").mockResolvedValue({
        id: "capture",
        parts: [{ id: "capture", box }],
      });
      vi.spyOn(env.client, "snapshotBytes").mockImplementation(() =>
        Promise.resolve(writeSchematic(current, registry.dataVersion)),
      );
      vi.spyOn(env.client, "regionRead").mockImplementation(() =>
        Promise.resolve(region()),
      );
      await captureSite(env, workspace.dir, { target: "sbx-000001", box });
      await workspace.writeExpected(region());
      await workspace.writeFrozen("expected", [
        { at: box.min, bytes: writeSchematic(original, registry.dataVersion) },
      ]);
      await appendLog(workspace.dir, {
        kind: "run",
        target: "sbx-000001",
        ops: 0,
        program: null,
      });
      const before = await evidence(workspace.dir);
      current = new BlockGrid(original.size, "minecraft:stone");
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
      const before = await evidence(workspace.dir);
      await workspace.writeOplog({ version: 1, ops: [clearFloorOp(2)] });
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
