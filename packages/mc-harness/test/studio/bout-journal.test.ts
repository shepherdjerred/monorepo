import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, expect, it, vi } from "vitest";
import type * as FileTransaction from "#build/file-transaction.ts";
import { renderBuild } from "#build/commands.ts";
import { DaemonClient } from "#build/daemon-client.ts";
import { Journal } from "#build/journal.ts";
import { readSidecar } from "#build/sidecar.ts";
import { rubricAxisIds } from "#build/judge.ts";
import { critiqueBuild } from "#build/studio/critique.ts";
import { critiquedIterations } from "#evals/grade/trajectory.ts";
import { appendLog, readLog } from "#build/build-log.ts";
import {
  publishBoutState,
  type OutcomeInput,
} from "#build/studio/bout-publication.ts";
import { flatSiteBuild, clearFloorOp } from "#test/fixtures/flat-site.ts";
import { saveCandidate, validateCandidate } from "#build/studio/candidates.ts";
import { knockout } from "#build/studio/knockout.ts";
import { compiledGrid } from "#build/sources.ts";

const beforeLock = vi.hoisted(() => {
  const state: { action: (() => Promise<void>) | null } = { action: null };
  return state;
});
vi.mock("#build/file-transaction.ts", async (importOriginal) => {
  const original = await importOriginal<typeof FileTransaction>();
  return {
    ...original,
    publishFiles: async (...args: Parameters<typeof original.publishFiles>) => {
      const action = beforeLock.action;
      beforeLock.action = null;
      await action?.();
      return original.publishFiles(...args);
    },
  };
});
vi.mock("@shepherdjerred/mc-build/render/assets.ts", async () => {
  const { renderAssets } = await import("#test/fixtures/render-assets.ts");
  return { ensureAssets: renderAssets };
});
const root = await mkdtemp(path.join(tmpdir(), "mc-bout-journal-"));
afterAll(async () => rm(root, { recursive: true }));

it("captures an intervening op log and journal as one reproducible candidate", async () => {
  const workspace = await flatSiteBuild(path.join(root, "save"), "save");
  await workspace.writeOplog({ version: 1, ops: [clearFloorOp(1)] });
  beforeLock.action = async () => {
    await workspace.writeOplog({ version: 1, ops: [clearFloorOp(2)] });
    await appendLog(workspace.dir, {
      kind: "render",
      name: "intervening",
      source: "compiled",
      files: [],
    });
  };
  const saved = await saveCandidate(workspace.dir, "saved");
  const validated = await validateCandidate(workspace.dir, "saved");
  const current = await compiledGrid(workspace, await workspace.manifest());
  expect(saved).toEqual(validated.candidate);
  expect(saved.iteration).toBe(1);
  expect(validated.oplog).toEqual(await workspace.oplog());
  expect(current.skipped).toEqual([]);
});

it("rejects an initial singleton replaced before best publication", async () => {
  const workspace = await flatSiteBuild(
    path.join(root, "singleton"),
    "singleton",
  );
  await workspace.writeOplog({ version: 1, ops: [clearFloorOp(1)] });
  const original = await saveCandidate(workspace.dir, "saved");
  beforeLock.action = async () => {
    await workspace.writeOplog({ version: 1, ops: [clearFloorOp(2)] });
    await saveCandidate(workspace.dir, "saved", { force: true });
  };
  const ask = vi.fn();
  await expect(
    knockout(workspace.dir, { rubric: "micro", model: "stub", ask }),
  ).rejects.toThrow(/changed during knockout/u);
  const manifest = await workspace.manifest();
  expect(manifest.best).toBeUndefined();
  const journal = await readLog(workspace.dir);
  expect(
    journal.some((entry) => entry.kind === "accept" || entry.kind === "reject"),
  ).toBe(false);
  const validated = await validateCandidate(workspace.dir, "saved");
  expect(validated.candidate.gridHash).not.toBe(original.gridHash);
  expect(ask).not.toHaveBeenCalled();
});

it("retains an intervening render and stamps the bout from the locked journal", async () => {
  const workspace = await flatSiteBuild(path.join(root, "bout"), "bout");
  const manifest = await workspace.manifest();
  const outcome: OutcomeInput = {
    kind: "accept",
    candidate: "one",
    versus: null,
    file: null,
    rubric: "micro",
    gridHash: "grid",
    critique: "judge/critique.json",
    score: 20,
  };
  beforeLock.action = async () => {
    await appendLog(workspace.dir, {
      kind: "render",
      name: "intervening",
      source: "compiled",
      files: [],
    });
  };
  await publishBoutState(workspace, {
    manifest,
    outcomes: [outcome],
    candidates: [],
  });
  expect(await readLog(workspace.dir)).toMatchObject([
    { kind: "render", name: "intervening", iteration: 1 },
    { kind: "accept", candidate: "one", iteration: 1 },
  ]);
  const journal = await readLog(workspace.dir);
  await publishBoutState(workspace, {
    manifest,
    outcomes: [outcome],
    candidates: [],
  });
  expect(await readLog(workspace.dir)).toEqual(journal);
});

it("reads the grid and provenance after an intervening render and grades both iterations", async () => {
  const workspace = await flatSiteBuild(path.join(root, "render"), "render");
  await workspace.writeOplog({ version: 1, ops: [clearFloorOp(1)] });
  const env = {
    client: new DaemonClient(),
    journal: new Journal(workspace.file("audit")),
    log: vi.fn(),
  };
  beforeLock.action = async () => {
    await renderBuild(env, workspace.dir, { source: "compiled", name: "one" });
    await workspace.writeOplog({ version: 1, ops: [clearFloorOp(2)] });
  };
  await renderBuild(env, workspace.dir, { source: "compiled", name: "two" });
  const one = await readSidecar(workspace, "one");
  const two = await readSidecar(workspace, "two");
  expect([one.iteration, two.iteration]).toEqual([1, 2]);
  expect(one.gridHash).not.toBe(two.gridHash);
  for (const render of ["one", "two"])
    await critiqueBuild(workspace.dir, {
      render,
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
  const journal = await readLog(workspace.dir);
  expect(
    journal
      .filter((entry) => entry.kind === "render")
      .map((entry) => entry.iteration),
  ).toEqual([1, 2]);
  expect(critiquedIterations(journal, "micro")).toBe(2);
});
