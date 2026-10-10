/**
 * Candidates: saved versions of a build (its program and op log, plus the
 * grid they compile to) so a session can try two or three variants, have a
 * blind judge pick, and restore the winner. `knockout.ts` does the judging;
 * this file only saves, lists and restores.
 */
import { cp, mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { gridHash } from "@shepherdjerred/mc-build/core/site.ts";
import {
  readSchematic,
  writeSchematic,
} from "@shepherdjerred/mc-build/core/schem.ts";
import type { BlockGrid } from "@shepherdjerred/mc-build/core/grid.ts";
import { loadRegistry } from "@shepherdjerred/mc-build/registry/registry.ts";
import {
  BUILD_FILES,
  CANDIDATE_FILES,
  CandidateSchema,
  type Candidate,
  type BuildManifest,
  type JudgeRubric,
} from "#protocol/build.ts";
import { appendLog, iterationOf, readLog } from "#build/build-log.ts";
import { checkName, producingProgram } from "#build/sidecar.ts";
import { compiledGrid } from "#build/sources.ts";
import { BuildWorkspace } from "#build/workspace.ts";

export function candidateDir(workspace: BuildWorkspace, name: string): string {
  return workspace.file(
    path.join(BUILD_FILES.candidatesDir, checkName("candidate", name)),
  );
}

/** A failed replacement leaves the complete saved version at its original path. */
async function replaceCandidate(staged: string, target: string): Promise<void> {
  const backup = `${staged}-previous`;
  let previous = false;
  try {
    await rename(target, backup);
    previous = true;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  try {
    await rename(staged, target);
  } catch (error) {
    if (previous) await rename(backup, target);
    throw error;
  }
  if (previous) await rm(backup, { recursive: true });
}

/** Validate identity without rejecting historical candidates from another capture. */
async function candidateMetadata(
  workspace: BuildWorkspace,
  name: string,
): Promise<Candidate> {
  const file = Bun.file(
    path.join(candidateDir(workspace, name), CANDIDATE_FILES.info),
  );
  const candidate = CandidateSchema.parse(await file.json());
  if (candidate.name !== name) {
    throw new Error(
      `candidate metadata "${name}" contains name "${candidate.name}"`,
    );
  }
  return candidate;
}

/**
 * The most recent critique of this exact grid, whichever render of it was
 * critiqued: the journal's critique entries are in time order and each
 * carries the hash of the grid it scored, so a reused render name cannot
 * hand an old opinion to a new grid. With a rubric, only critiques on that
 * rubric count: a micro total is never a map score.
 */
async function latestCritique(
  dir: string,
  hash: string,
  rubric?: JudgeRubric,
): Promise<Candidate["score"]> {
  const journal = await readLog(dir);
  for (let index = journal.length - 1; index >= 0; index -= 1) {
    const entry = journal[index];
    if (
      entry?.kind === "critique" &&
      entry.gridHash === hash &&
      (rubric === undefined || entry.rubric === rubric)
    ) {
      return { rubric: entry.rubric, total: entry.total };
    }
  }
  return null;
}

/**
 * A saved candidate's current critique total on `rubric` (critiques after
 * the save count too), or null when its grid was never critiqued on it.
 */
export async function candidateScore(
  dir: string,
  name: string,
  rubric: JudgeRubric,
): Promise<number | null> {
  const candidate = await readCandidate(dir, name);
  const latest = await latestCritique(dir, candidate.gridHash, rubric);
  return latest === null ? null : latest.total;
}

/** Saves the current program and op log, compiled offline, as `candidates/<name>/`. */
export async function saveCandidate(
  dir: string,
  name: string,
  options: { force?: boolean } = {},
): Promise<Candidate> {
  const workspace = new BuildWorkspace(dir);
  const manifest = await workspace.manifest();
  if (manifest.site === undefined) {
    throw new Error("candidate save requires a captured site");
  }
  const target = candidateDir(workspace, name);
  const exists = await Bun.file(
    path.join(target, CANDIDATE_FILES.info),
  ).exists();
  if (exists && !(options.force ?? false)) {
    throw new Error(`candidate "${name}" exists; pass --force to replace it`);
  }
  if (exists && manifest.best?.candidate === name) {
    // The incumbent earned its place in a bout; a replacement has to win one too.
    throw new Error(
      `candidate "${name}" is the incumbent (build.json best); save the new version under another name and run knockout`,
    );
  }
  const { grid, skipped } = await compiledGrid(workspace, manifest);
  if (skipped.length > 0) {
    // A candidate is judged from its compiled grid; ops with no offline
    // result would make that grid a different build from the canvas.
    throw new Error(
      `candidate "${name}" cannot be saved: ${skipped.length.toString()} op(s) in the log have no offline result and the compiled grid would not be the build (${skipped.join("; ")}); keep to paste and //set air ops`,
    );
  }
  const registry = await loadRegistry();
  const oplog = await workspace.oplog();
  const producer = await producingProgram(workspace, oplog.ops);
  // The candidate's program is the snapshot that compiled its ops, not the
  // live build.ts, which may have been edited since; a log not produced by
  // one compile has no program.
  const program = producer !== null;
  const hash = gridHash(grid);
  const journal = await readLog(dir);
  let blocks = 0;
  grid.forEach((x, y, z) => {
    if (!grid.isAirAt(x, y, z)) blocks += 1;
  });
  const candidate: Candidate = {
    name,
    at: new Date().toISOString(),
    iteration: iterationOf(journal),
    gridHash: hash,
    capture: {
      siteHash: manifest.site.siteHash,
      box: workspace.siteBox(manifest),
    },
    size: grid.size,
    blocks,
    program,
    ops: oplog.ops.length,
    score: await latestCritique(dir, hash),
  };
  const staged = await mkdtemp(workspace.file(`.candidate-${name}-`));
  try {
    if (producer !== null) {
      await cp(
        workspace.file(producer),
        path.join(staged, BUILD_FILES.program),
      );
    }
    await cp(
      workspace.file(BUILD_FILES.oplog),
      path.join(staged, BUILD_FILES.oplog),
    );
    await Bun.write(
      path.join(staged, CANDIDATE_FILES.grid),
      writeSchematic(grid, registry.dataVersion),
    );
    await Bun.write(
      path.join(staged, CANDIDATE_FILES.info),
      `${JSON.stringify(CandidateSchema.parse(candidate), null, 2)}\n`,
    );
    await mkdir(path.dirname(target), { recursive: true });
    await replaceCandidate(staged, target);
  } finally {
    await rm(staged, { recursive: true, force: true });
  }
  await appendLog(dir, { kind: "candidate", action: "save", name });
  return candidate;
}

export function candidateMatchesCapture(
  candidate: Candidate,
  workspace: BuildWorkspace,
  manifest: BuildManifest,
): boolean {
  return (
    manifest.site !== undefined &&
    isDeepStrictEqual(candidate.capture, {
      siteHash: manifest.site.siteHash,
      box: workspace.siteBox(manifest),
    })
  );
}

export async function readCandidate(
  dir: string,
  name: string,
): Promise<Candidate> {
  const workspace = new BuildWorkspace(dir);
  const file = Bun.file(
    path.join(candidateDir(workspace, name), CANDIDATE_FILES.info),
  );
  if (!(await file.exists())) {
    throw new Error(
      `no candidate "${name}" in ${workspace.dir}; toolkit mc build candidate ${dir} ls`,
    );
  }
  const candidate = await candidateMetadata(workspace, name);
  const manifest = await workspace.manifest();
  if (!candidateMatchesCapture(candidate, workspace, manifest)) {
    throw new Error(
      `candidate "${name}" belongs to a different capture; save a candidate for the current site before picking or judging it`,
    );
  }
  return candidate;
}

export async function candidateGrid(
  dir: string,
  name: string,
): Promise<BlockGrid> {
  const workspace = new BuildWorkspace(dir);
  const candidate = await readCandidate(dir, name);
  const file = path.join(candidateDir(workspace, name), CANDIDATE_FILES.grid);
  const schematic = await readSchematic(
    new Uint8Array(await Bun.file(file).arrayBuffer()),
  );
  if (gridHash(schematic.grid) !== candidate.gridHash) {
    throw new Error(`candidate "${name}" grid does not match its saved hash`);
  }
  return schematic.grid;
}

/** Every saved candidate, oldest first, with the incumbent flagged. */
export async function listCandidates(
  dir: string,
): Promise<(Candidate & { best: boolean })[]> {
  const workspace = new BuildWorkspace(dir);
  const manifest = await workspace.manifest();
  let names: string[];
  try {
    names = await readdir(workspace.file(BUILD_FILES.candidatesDir));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return [];
    throw error;
  }
  const candidates = [];
  for (const name of names.toSorted()) {
    const candidate = await candidateMetadata(workspace, name);
    candidates.push({ ...candidate, best: manifest.best?.candidate === name });
  }
  return candidates.toSorted((a, b) => a.at.localeCompare(b.at));
}

/** Restores a candidate's program and op log as the working version. */
export async function pickCandidate(
  dir: string,
  name: string,
): Promise<Candidate> {
  const workspace = new BuildWorkspace(dir);
  const candidate = await readCandidate(dir, name);
  const source = candidateDir(workspace, name);
  if (candidate.program) {
    await cp(
      path.join(source, BUILD_FILES.program),
      workspace.file(BUILD_FILES.program),
    );
  } else {
    // The candidate had no program; a stale build.ts would recompile over its op log.
    await rm(workspace.file(BUILD_FILES.program), { force: true });
  }
  await cp(
    path.join(source, BUILD_FILES.oplog),
    workspace.file(BUILD_FILES.oplog),
  );
  await appendLog(dir, { kind: "candidate", action: "pick", name });
  return candidate;
}
