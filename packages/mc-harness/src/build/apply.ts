import { gridHash } from "@shepherdjerred/mc-build/core/site.ts";
import type { BuildManifest } from "#protocol/build.ts";
import { Journal, type JournalEntry } from "./journal.ts";
import {
  diffGrids,
  readGrid,
  resetToSite,
  runOps,
  type GridDiff,
} from "./ops.ts";
import { BuildWorkspace } from "./workspace.ts";
import { type Env, sha, context, seededSandbox } from "./helpers.ts";

export async function replayBuild(
  env: Env,
  dir: string,
  options: { target?: string; keep?: boolean },
): Promise<{ target: string; ops: number } & GridDiff> {
  const workspace = new BuildWorkspace(dir);
  const manifest = await workspace.manifest();
  const box = workspace.siteBox(manifest);
  const expected = await workspace.expected();
  const target =
    options.target ?? (await seededSandbox(env, workspace, manifest, 3600));
  try {
    const run = context(env, workspace, manifest, target);
    if (options.target !== undefined) {
      await resetToSite(run, box);
    }
    const { ops } = await workspace.oplog();
    await runOps(run, ops);
    const diff = diffGrids(
      expected,
      await readGrid(env.client, target, box),
      box.min,
    );
    return { target, ops: ops.length, ...diff };
  } finally {
    if (options.target === undefined && options.keep !== true) {
      await env.client.destroySandbox(target);
    }
  }
}

async function planFor(
  env: Env,
  workspace: BuildWorkspace,
  manifest: BuildManifest,
  target: string,
) {
  const box = workspace.siteBox(manifest);
  const expected = await workspace.expected();
  const { ops } = await workspace.oplog();
  const current = await readGrid(env.client, target, box);
  const siteHash = manifest.site?.siteHash ?? "";
  const frozen = await workspace.frozenParts("expected", box);
  const planHash = sha(
    JSON.stringify({
      target,
      siteHash,
      ops,
      expected: gridHash(expected),
      frozen: frozen.map((part) => ({ at: part.at, sha: sha(part.bytes) })),
    }),
  );
  return {
    box,
    expected,
    ops,
    current,
    siteHash,
    planHash,
    frozen,
    drifted: gridHash(current) !== siteHash,
  };
}

export type PromoteResult = {
  target: string;
  planHash: string;
  ops: number;
  changes: number;
  applied: JournalEntry | null;
  diff: GridDiff | null;
};

/**
 * Dry run (no --confirm): checks the target still matches the captured site
 * and prints the plan hash. With --confirm <planHash>: snapshots the box,
 * pastes the frozen canvas result (expected.schem), verifies, and journals.
 */
export async function promoteBuild(
  env: Env,
  dir: string,
  options: { target: string; confirm?: string },
): Promise<PromoteResult> {
  const workspace = new BuildWorkspace(dir);
  const manifest = await workspace.manifest();
  const plan = await planFor(env, workspace, manifest, options.target);
  if (plan.drifted) {
    throw new Error(
      `${options.target} no longer matches the captured site (siteHash drift). Re-capture the site, rebuild, and replay before promoting.`,
    );
  }
  const changes = plan.expected.diff(plan.current, 0).count;
  const base = {
    target: options.target,
    planHash: plan.planHash,
    ops: plan.ops.length,
    changes,
  };
  if (options.confirm === undefined) {
    return { ...base, applied: null, diff: null };
  }
  if (options.confirm !== plan.planHash) {
    throw new Error(
      `--confirm ${options.confirm} does not match the current plan ${plan.planHash}; re-run the dry run`,
    );
  }
  const applyId = Journal.newId();
  const snapshot = await env.client.snapshotParts(
    options.target,
    plan.box,
    `undo:${applyId}`,
  );
  const now = new Date().toISOString();
  const entry: JournalEntry = {
    version: 1,
    applyId,
    target: options.target,
    buildDir: workspace.dir,
    world: plan.box.world,
    min: plan.box.min,
    max: plan.box.max,
    planHash: plan.planHash,
    snapshotId: snapshot.id,
    siteHash: plan.siteHash,
    status: "applying",
    mismatches: null,
    createdAt: now,
    updatedAt: now,
  };
  await env.journal.write(entry);
  for (const part of plan.frozen) {
    await env.client.paste(options.target, {
      session: BuildWorkspace.session(manifest),
      world: plan.box.world,
      schematic: Buffer.from(part.bytes).toString("base64"),
      at: part.at,
      rotate: 0,
      ignoreAir: false,
      history: false,
    });
  }
  const diff = diffGrids(
    plan.expected,
    await readGrid(env.client, options.target, plan.box),
    plan.box.min,
  );
  const done: JournalEntry = {
    ...entry,
    status: diff.mismatches === 0 ? "verified" : "failed",
    mismatches: diff.mismatches,
    updatedAt: new Date().toISOString(),
  };
  await env.journal.write(done);
  return { ...base, applied: done, diff };
}

export async function verifyApply(
  env: Env,
  applyId: string,
): Promise<{ entry: JournalEntry } & GridDiff> {
  const entry = await env.journal.find(applyId);
  const workspace = new BuildWorkspace(entry.buildDir);
  const box = { world: entry.world, min: entry.min, max: entry.max };
  const diff = diffGrids(
    await workspace.expected(),
    await readGrid(env.client, entry.target, box),
    box.min,
  );
  const updated: JournalEntry = {
    ...entry,
    status: diff.mismatches === 0 ? "verified" : "failed",
    mismatches: diff.mismatches,
    updatedAt: new Date().toISOString(),
  };
  await env.journal.write(updated);
  return { entry: updated, ...diff };
}

export async function undoApply(
  env: Env,
  applyId: string,
): Promise<{ entry: JournalEntry; restoredToSite: boolean }> {
  const entry = await env.journal.find(applyId);
  if (entry.status === "undone") {
    throw new Error(`${applyId} is already undone`);
  }
  const blockers = await env.journal.blockers(entry);
  if (blockers.length > 0) {
    throw new Error(
      `Undo is last-in-first-out: undo ${blockers.map((other) => other.applyId).join(", ")} first (they overlap ${applyId}).`,
    );
  }
  await env.client.restore(entry.target, entry.snapshotId);
  const box = { world: entry.world, min: entry.min, max: entry.max };
  const restored =
    gridHash(await readGrid(env.client, entry.target, box)) === entry.siteHash;
  const updated: JournalEntry = {
    ...entry,
    status: "undone",
    updatedAt: new Date().toISOString(),
  };
  await env.journal.write(updated);
  return { entry: updated, restoredToSite: restored };
}

export async function buildStatus(
  env: Env,
  dir: string,
): Promise<{
  manifest: BuildManifest;
  ops: { manual: number; program: number };
  applies: JournalEntry[];
}> {
  const workspace = new BuildWorkspace(dir);
  const manifest = await workspace.manifest();
  const { ops } = await workspace.oplog();
  const program = ops.filter((op) => op.source.startsWith("program:")).length;
  const entries = await env.journal.list();
  const applies = entries.filter((entry) => entry.buildDir === workspace.dir);
  return { manifest, ops: { manual: ops.length - program, program }, applies };
}
