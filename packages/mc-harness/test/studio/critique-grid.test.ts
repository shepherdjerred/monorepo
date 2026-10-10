import { mkdtemp, rm, symlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterAll, describe, expect, it, vi } from "vitest";
import { clearFloorOp, flatSiteBuild } from "#test/fixtures/flat-site.ts";
import { critiqueBuild } from "#build/studio/critique.ts";
import { renderBuild } from "#build/commands.ts";
import { DaemonClient } from "#build/daemon-client.ts";
import { Journal } from "#build/journal.ts";
import { rubricAxisIds } from "#build/judge.ts";
import { readLog } from "#build/build-log.ts";
import { BUILD_FILES, JudgeCritiqueRecordSchema } from "#protocol/build.ts";
import { readJournal, trajectoryChecks } from "#evals/grade/trajectory.ts";
import { keepBuildRecord } from "#evals/lib/build-record.ts";

vi.mock("@shepherdjerred/mc-build/render/assets.ts", async () => {
  const { renderAssets } = await import("#test/fixtures/render-assets.ts");
  return { ensureAssets: renderAssets };
});
const root = await mkdtemp(path.join(os.tmpdir(), "mc-critique-grid-"));
afterAll(async () => rm(root, { recursive: true }));
const options = {
  render: "look",
  rubric: "micro" as const,
  model: "stub",
  stage: "visual" as const,
  byEye: {
    axes: Object.fromEntries(rubricAxisIds("micro").map((axis) => [axis, 3])),
    overallAesthetic: 3,
    notes: [],
  },
};

async function fixture(name: string) {
  const workspace = await flatSiteBuild(path.join(root, name), name);
  const env = {
    client: new DaemonClient(),
    journal: new Journal(workspace.file("audit")),
    log: vi.fn(),
  };
  await workspace.writeOplog({ version: 1, ops: [clearFloorOp(1)] });
  await renderBuild(env, workspace.dir, { source: "compiled", name: "look" });
  const critique = await critiqueBuild(workspace.dir, options);
  const record = JudgeCritiqueRecordSchema.parse(
    await Bun.file(workspace.file(critique.record)).json(),
  );
  expect(await readJournal(workspace.dir)).toHaveProperty("entries");
  return { workspace, env, critique, record };
}

describe("critique grid identity", () => {
  it.each(["missing", "bytes", "escape"])(
    "rejects %s schematic evidence before grading or archival",
    async (failure) => {
      const { workspace, record } = await fixture(failure);
      const file = workspace.file(record.grid);
      if (failure === "missing") await rm(file);
      else if (failure === "bytes")
        await Bun.write(file, "truncated schematic");
      else {
        const outside = path.join(root, "outside.schem");
        await Bun.write(outside, await Bun.file(file).bytes());
        await rm(file);
        await symlink(outside, file);
      }
      const journal = await readJournal(workspace.dir);
      expect(journal).toHaveProperty("error");
      expect(
        trajectoryChecks(journal, "micro").every((check) => !check.pass),
      ).toBe(true);
      await expect(
        keepBuildRecord(workspace.dir, path.join(root, `archive-${failure}`)),
      ).rejects.toThrow();
    },
  );

  it("rejects a copied critique whose record and journal consistently claim another grid", async () => {
    const { workspace, record } = await fixture("copied-hash");
    const entries = await readLog(workspace.dir);
    const entry = entries.find((item) => item.kind === "critique");
    if (entry?.kind !== "critique") throw new Error("missing fixture critique");
    const file = "judge/copied.json";
    const gridHash = "f".repeat(64);
    await Bun.write(
      workspace.file(file),
      JSON.stringify({ ...record, gridHash }),
    );
    await Bun.write(
      workspace.file(BUILD_FILES.journal),
      [...entries, { ...entry, file, gridHash }]
        .map((item) => JSON.stringify(item))
        .join("\n"),
    );
    const journal = await readJournal(workspace.dir);
    expect(journal).toHaveProperty("error");
    expect(
      trajectoryChecks(journal, "micro").every((check) => !check.pass),
    ).toBe(true);
    await expect(
      keepBuildRecord(workspace.dir, path.join(root, "archive-copied")),
    ).rejects.toThrow(/hash does not match/u);
  });

  it("keeps historical grids after a render name is replaced and through two archive hops", async () => {
    const { workspace, env, record } = await fixture("historical");
    const original = await Bun.file(workspace.file(record.grid)).bytes();
    await workspace.writeOplog({ version: 1, ops: [clearFloorOp(2)] });
    await renderBuild(env, workspace.dir, { source: "compiled", name: "look" });
    await critiqueBuild(workspace.dir, options);
    expect(await readJournal(workspace.dir)).toHaveProperty("entries");
    expect(await Bun.file(workspace.file(record.grid)).bytes()).toEqual(
      original,
    );
    const first = path.join(root, "archive-first");
    const second = path.join(root, "archive-second");
    await keepBuildRecord(workspace.dir, first);
    await keepBuildRecord(first, second);
    await rm(workspace.dir, { recursive: true });
    await rm(first, { recursive: true });
    const journal = await readJournal(second);
    expect(journal).toHaveProperty("entries");
    expect(trajectoryChecks(journal, "micro")[1]?.pass).toBe(true);
  });
});
