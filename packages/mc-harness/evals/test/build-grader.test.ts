import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { flatSiteBuild } from "#test/fixtures/flat-site.ts";
import { renderBuild } from "#build/commands.ts";
import { critiqueBuild } from "#build/studio/critique.ts";
import { rubricAxisIds } from "#build/judge.ts";
import { DaemonClient as BuildClient } from "#build/daemon-client.ts";
import { Journal } from "#build/journal.ts";
import { DaemonClient } from "#evals/lib/daemon.ts";
import { buildGrader } from "#evals/grade/build.ts";
import { readJournal } from "#evals/grade/trajectory.ts";
import { keepBuildRecord } from "#evals/lib/build-record.ts";
import type { GradeContext } from "#evals/lib/types.ts";

vi.mock("@shepherdjerred/mc-build/render/assets.ts", async () => {
  const { renderAssets } = await import("#test/fixtures/render-assets.ts");
  return { ensureAssets: renderAssets };
});

const root = await mkdtemp(path.join(tmpdir(), "mc-build-grader-"));
afterAll(async () => rm(root, { recursive: true }));

function context(buildDir: string, taskDir: string): GradeContext {
  const daemon = new DaemonClient(root);
  vi.spyOn(daemon, "request").mockImplementation((schema) =>
    Promise.resolve(
      schema.parse({
        world: "world",
        min: { x: 100, y: 64, z: 100 },
        max: { x: 109, y: 73, z: 109 },
        size: { x: 10, y: 10, z: 10 },
        palette: ["minecraft:air"],
        blocks: Buffer.alloc(4000).toString("base64"),
        blockEntities: [],
      }),
    ),
  );
  return {
    taskId: "fixture",
    taskDir,
    outDir: path.join(taskDir, "out"),
    home: root,
    worktree: root,
    result: { sourceSandbox: "sbx-000001", buildDir, applyId: "fixture" },
    daemon,
    toolkit: (args) =>
      Promise.resolve({
        exitCode: 0,
        stdout: JSON.stringify(
          args.includes("verify")
            ? { mismatches: 0 }
            : { ok: true, errors: 0, warnings: 0 },
        ),
        stderr: "",
      }),
    exec: () =>
      Promise.resolve({ exitCode: 1, stdout: "", stderr: "no fixture render" }),
  };
}

describe("build grader evidence failures", () => {
  it.each(["current-record", "current-image", "historical-record", "valid"])(
    "returns a grade for %s evidence without a partial archive",
    async (failure) => {
      const dir = path.join(root, failure);
      const workspace = await flatSiteBuild(path.join(dir, "build"), failure);
      await renderBuild(
        {
          client: new BuildClient(),
          journal: new Journal(workspace.file("audit")),
          log: vi.fn(),
        },
        workspace.dir,
        { source: "compiled", name: "fixture" },
      );
      const critique = await critiqueBuild(workspace.dir, {
        render: "fixture",
        rubric: "micro",
        model: "stub",
        stage: "visual",
        byEye: {
          axes: Object.fromEntries(rubricAxisIds("micro").map((id) => [id, 3])),
          overallAesthetic: 3,
          notes: [],
        },
      });
      if (failure === "current-record")
        await Bun.write(workspace.file(critique.record), "{bad JSON");
      if (failure === "current-image")
        await Bun.write(workspace.file(critique.sheet), "damaged PNG");
      if (failure === "historical-record")
        await Bun.write(workspace.file("judge/old-unreferenced.json"), "{}");
      const journal = await readJournal(workspace.dir);
      expect(journal).toHaveProperty(
        failure.startsWith("current-") ? "error" : "entries",
      );
      const taskDir = path.join(dir, "task");
      const grade = await buildGrader({
        reference: "fixture",
        rubric: "micro",
      })(context(workspace.dir, taskDir));
      const archiveCheck = grade.checks.find((check) =>
        check.name.startsWith("build evidence can be archived"),
      );
      expect(archiveCheck?.pass).toBe(failure === "valid");
      const taskFiles = await readdir(taskDir);
      expect(taskFiles.some((name) => name.startsWith(".build-record-"))).toBe(
        false,
      );
      if (failure === "valid") {
        expect(grade.artifacts).toContain(path.join(taskDir, "journal.jsonl"));
        expect(await readJournal(taskDir)).toHaveProperty("entries");
        expect(
          await keepBuildRecord(taskDir, path.join(dir, "bench")),
        ).not.toEqual([]);
      } else {
        expect(grade.checks.some((check) => !check.pass)).toBe(true);
        expect(grade.artifacts).not.toContain(
          path.join(taskDir, "journal.jsonl"),
        );
        expect(await keepBuildRecord(taskDir, path.join(dir, "bench"))).toEqual(
          [],
        );
        expect(await readdir(taskDir)).not.toContain("judge");
      }
    },
  );
});
