import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import type * as FileSystem from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterAll, describe, expect, it, vi } from "vitest";
import { flatSiteBuild, clearFloorOp } from "#test/fixtures/flat-site.ts";
import { renderBuild } from "#build/commands.ts";
import { critiqueBuild } from "#build/studio/critique.ts";
import { readJournal } from "#evals/grade/trajectory.ts";
import { readLog } from "#build/build-log.ts";
import { programSnapshot } from "#build/sidecar.ts";
import { rubricAxisIds } from "#build/judge.ts";
import { DaemonClient } from "#build/daemon-client.ts";
import { Journal } from "#build/journal.ts";
import { BUILD_FILES } from "#protocol/build.ts";

const failure = vi.hoisted(() => ({ kind: "", install: "" }));
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
      if (
        failure.install !== "" &&
        (from.includes(".render-") || from.includes(".critique-publish-")) &&
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
  await Bun.write(
    workspace.file(programSnapshot("abcd")),
    "// producing program\n",
  );
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
        relative === BUILD_FILES.journal)
    )
      result[relative] = await Bun.file(path.join(dir, relative)).bytes();
  }
  return result;
}

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
