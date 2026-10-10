import { buildArtifactPath } from "#build/storage/artifact-path.ts";
/**
 * Candidates: saved versions of a build (its program and op log, plus the
 * grid they compile to) so a session can try two or three variants, have a
 * blind judge pick, and restore the winner. `knockout.ts` does the judging;
 * this file only saves, lists and restores.
 */
import { cp, lstat, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
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
  OpLogSchema,
  type Candidate,
  type BuildManifest,
  type JudgeRubric,
} from "#protocol/build.ts";
import { iterationOf, readLog } from "#build/build-log.ts";
import { publishFiles } from "#build/file-transaction.ts";
import { stageJournal } from "#build/storage/evidence-publication.ts";
import { checkName, producingProgram } from "#build/sidecar.ts";
import { compiledGrid } from "#build/sources.ts";
import { BuildWorkspace } from "#build/workspace.ts";
import { critiqueForGrid } from "./critique-record.ts";
import { installWorkingFiles } from "./working-files.ts";

export function candidateDir(workspace: BuildWorkspace, name: string): string {
  return workspace.file(
    path.join(BUILD_FILES.candidatesDir, checkName("candidate", name)),
  );
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
  const entry = await critiqueForGrid(new BuildWorkspace(dir), hash, rubric);
  return entry === null ? null : { rubric: entry.rubric, total: entry.total };
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
  const evidence = await candidateEvidence(dir, name, rubric);
  return evidence.score;
}

export async function candidateEvidence(
  dir: string,
  name: string,
  rubric: JudgeRubric,
) {
  const candidate = await readCandidate(dir, name);
  const critique = await critiqueForGrid(
    new BuildWorkspace(dir),
    candidate.gridHash,
    rubric,
  );
  return {
    gridHash: candidate.gridHash,
    critique: critique?.file ?? null,
    score: critique?.total ?? null,
  };
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
  const exists = await lstat(target).then(
    () => true,
    (error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return false;
      throw error;
    },
  );
  if (exists) await candidateMetadata(workspace, name);
  if (exists && !(options.force ?? false)) {
    throw new Error(`candidate "${name}" exists; pass --force to replace it`);
  }
  if (manifest.best?.candidate === name) {
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
  const programBytes =
    producer === null
      ? null
      : await Bun.file(await buildArtifactPath(workspace, producer)).bytes();
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
    programHash:
      programBytes === null
        ? null
        : createHash("sha256").update(programBytes).digest("hex"),
    ops: oplog.ops.length,
    score: await latestCritique(dir, hash),
  };
  const relative = path.relative(workspace.dir, target);
  await publishFiles(workspace, {
    prefix: `.candidate-${name}-`,
    exclusive: options.force === true ? [] : [relative],
    stage: async (pending) => {
      const staged = path.join(pending, relative);
      await mkdir(staged, { recursive: true });
      if (programBytes !== null) {
        await Bun.write(path.join(staged, BUILD_FILES.program), programBytes);
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
      await stageJournal(workspace, new BuildWorkspace(pending), {
        kind: "candidate",
        action: "save",
        name,
      });
      // A process exit after installing the candidate must already have its save entry.
      return [BUILD_FILES.journal, relative];
    },
  });
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
  const file = await buildArtifactPath(
    workspace,
    path.join(BUILD_FILES.candidatesDir, name, CANDIDATE_FILES.grid),
  );
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
    const entries = await readdir(workspace.file(BUILD_FILES.candidatesDir), {
      withFileTypes: true,
    });
    names = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
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

/** Validate every artifact needed to restore and reproduce a saved candidate. */
export async function validateCandidate(dir: string, name: string) {
  const workspace = new BuildWorkspace(dir);
  const candidate = await readCandidate(dir, name);
  const artifact = (file: string) =>
    buildArtifactPath(
      workspace,
      path.join(BUILD_FILES.candidatesDir, name, file),
    );
  await candidateGrid(dir, name);
  const oplog = OpLogSchema.parse(
    await Bun.file(await artifact(BUILD_FILES.oplog)).json(),
  );
  if (oplog.ops.length !== candidate.ops) {
    throw new Error(
      `candidate "${name}" op count does not match its saved metadata`,
    );
  }
  const reproduced = await compiledGrid(
    workspace,
    await workspace.manifest(),
    oplog.ops,
  );
  if (
    reproduced.skipped.length > 0 ||
    gridHash(reproduced.grid) !== candidate.gridHash
  ) {
    throw new Error(
      `candidate "${name}" op log does not reproduce its saved grid`,
    );
  }
  const program = candidate.program
    ? await Bun.file(await artifact(BUILD_FILES.program)).bytes()
    : null;
  const programHash =
    program === null
      ? null
      : createHash("sha256").update(program).digest("hex");
  if (programHash !== candidate.programHash) {
    throw new Error(
      `candidate "${name}" program does not match its saved hash`,
    );
  }
  return { candidate, program, oplog };
}

/** Restores a candidate's program and op log as the working version. */
export async function pickCandidate(
  dir: string,
  name: string,
): Promise<Candidate> {
  const workspace = new BuildWorkspace(dir);
  const { candidate, program, oplog } = await validateCandidate(dir, name);
  await installWorkingFiles(workspace, {
    program,
    oplog: `${JSON.stringify(oplog, null, 2)}\n`,
    pick: name,
  });
  return candidate;
}
