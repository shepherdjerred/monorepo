import { buildArtifactPath } from "#build/storage/artifact-path.ts";
/**
 * `renders/<name>.json` sidecars: what a render was of and what the checks
 * (lint, then a critique) said about it. Written by `build render`, read by
 * `critique`, `candidate` and `resume`.
 */
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  BUILD_FILES,
  RenderSidecarSchema,
  type BuildLogEntry,
  type Op,
  type RenderSidecar,
} from "#protocol/build.ts";
import { currentRun, lastOf, readLog } from "./build-log.ts";
import type { BuildWorkspace } from "./workspace.ts";
import {
  programSnapshot,
  readProgramSnapshot,
  verifyProgramOps,
} from "./storage/program-evidence.ts";

const NAME = /^[a-z0-9][a-z0-9-]{0,31}$/u;

export type RenderProvenance = {
  journal: BuildLogEntry[];
  programText: string | null;
};

/** Read all required program evidence before replacing any render artifact. */
export async function readRenderProvenance(
  workspace: BuildWorkspace,
  source: string,
  target?: string,
): Promise<RenderProvenance> {
  const journal = await readLog(workspace.dir);
  const oplog = await workspace.oplog();
  let renderedTarget = target;
  if (source === "canvas" && renderedTarget === undefined) {
    const manifest = await workspace.manifest();
    renderedTarget = manifest.canvas;
  }
  const producer = await programBehind(workspace, {
    source,
    ...(renderedTarget === undefined ? {} : { target: renderedTarget }),
    ops: oplog.ops,
    journal,
  });
  return {
    journal,
    programText:
      producer === null ? null : await readProgramText(workspace, producer),
  };
}

/**
 * Render and candidate names become file names under the build directory,
 * so they are plain slugs: `--name ../build` must not write beside the build.
 */
export function checkName(what: "render" | "candidate", name: string): string {
  if (!NAME.test(name)) {
    throw new Error(
      `${what} names are 1-32 lowercase letters, digits or hyphens (got "${name}")`,
    );
  }
  return name;
}

function sidecarFile(workspace: BuildWorkspace, name: string): string {
  return workspace.file(
    path.join(BUILD_FILES.rendersDir, `${checkName("render", name)}.json`),
  );
}

export async function readSidecar(
  workspace: BuildWorkspace,
  name: string,
): Promise<RenderSidecar> {
  const file = Bun.file(sidecarFile(workspace, name));
  if (!(await file.exists())) {
    throw new Error(
      `no render named "${name}" in ${workspace.dir} (${BUILD_FILES.rendersDir}/${name}.json); run toolkit mc build render first`,
    );
  }
  const sidecar = RenderSidecarSchema.parse(await file.json());
  if (sidecar.name !== name) {
    throw new Error(`render sidecar "${name}" contains name "${sidecar.name}"`);
  }
  const program = path.join(BUILD_FILES.rendersDir, `${name}.build.ts`);
  if (sidecar.program !== null && sidecar.program !== program) {
    throw new Error(
      `render sidecar "${name}" must reference program "${program}"`,
    );
  }
  return sidecar;
}

export async function writeSidecar(
  workspace: BuildWorkspace,
  sidecar: RenderSidecar,
): Promise<string> {
  const file = sidecarFile(workspace, sidecar.name);
  await Bun.write(
    file,
    `${JSON.stringify(RenderSidecarSchema.parse(sidecar), null, 2)}\n`,
  );
  return file;
}

/** Every sidecar in the build, newest first. */
export async function allSidecars(
  workspace: BuildWorkspace,
): Promise<RenderSidecar[]> {
  const dir = workspace.file(BUILD_FILES.rendersDir);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return [];
    throw error;
  }
  const sidecars: RenderSidecar[] = [];
  for (const name of names.filter((entry) => entry.endsWith(".json"))) {
    const file = path.join(dir, name);
    try {
      sidecars.push(await readSidecar(workspace, path.parse(name).name));
    } catch (error) {
      throw new Error(`invalid render sidecar ${file}`, { cause: error });
    }
  }
  return sidecars.toSorted((a, b) => b.at.localeCompare(a.at));
}

/**
 * The render a command means when none is named: the journal's last render,
 * else the newest sidecar on disk (renders made before the journal existed).
 */
export async function latestRenderName(
  workspace: BuildWorkspace,
  journal: readonly BuildLogEntry[],
): Promise<string> {
  const capture = journal.findLastIndex((entry) => entry.kind === "capture");
  const last = lastOf(journal.slice(capture + 1), "render");
  if (last?.kind === "render") return last.name;
  if (capture !== -1) {
    throw new Error(
      "current capture has no render; run toolkit mc build render first",
    );
  }
  const [newest] = await allSidecars(workspace);
  if (newest !== undefined) return newest.name;
  const dir = workspace.file(BUILD_FILES.rendersDir);
  const exists = await stat(dir).then(
    () => true,
    () => false,
  );
  throw new Error(
    exists
      ? `${dir} has no renders with a sidecar; run toolkit mc build render first`
      : `${dir} does not exist; run toolkit mc build render first`,
  );
}

export async function readProgramText(
  workspace: BuildWorkspace,
  file: string,
): Promise<string> {
  return path.dirname(file) === BUILD_FILES.schematicsDir
    ? new TextDecoder().decode(await readProgramSnapshot(workspace, file))
    : Bun.file(await buildArtifactPath(workspace, file)).text();
}

async function checkedSnapshot(
  workspace: BuildWorkspace,
  file: string,
): Promise<string> {
  if (
    path.dirname(file) !== BUILD_FILES.schematicsDir ||
    !/^program-[a-f0-9]+\.build\.ts$/u.test(path.basename(file))
  ) {
    throw new Error(`invalid producing program snapshot path: ${file}`);
  }
  await readProgramText(workspace, file);
  return file;
}

/**
 * The program that produced every op in the log, as a snapshot path, or
 * null: a log with manual or imported ops, more than one compile, or none
 * at all was not produced by one program, and the current build.ts may
 * already differ from the one that compiled.
 */
export async function producingProgram(
  workspace: BuildWorkspace,
  ops: readonly Op[],
): Promise<string | null> {
  const digests = new Set<string>();
  for (const op of ops) {
    if (!op.source.startsWith("program:")) return null;
    digests.add(op.source.slice("program:".length));
  }
  const [digest, ...others] = [...digests];
  if (digest === undefined || others.length > 0) return null;
  const snapshot = programSnapshot(digest);
  if (!(await Bun.file(workspace.file(snapshot)).exists())) {
    throw new Error(
      `missing producing program snapshot ${workspace.file(snapshot)}`,
    );
  }
  await verifyProgramOps(workspace, snapshot, ops);
  return checkedSnapshot(workspace, snapshot);
}

/**
 * The program behind a render of `source`. A `compiled` grid is the op log
 * as it stands. The frozen `expected` result is the last `run`, whose entry
 * names the program it ran, whatever has been compiled since. The canvas
 * is that run plus anything recorded after it, so it has a program only
 * while the op log still says the same one as a run on that exact sandbox.
 */
export async function programBehind(
  workspace: BuildWorkspace,
  input: {
    source: string;
    target?: string;
    ops: readonly Op[];
    journal: readonly BuildLogEntry[];
  },
): Promise<string | null> {
  const run = currentRun(input.journal);
  const ran = run?.kind === "run" ? run.program : null;
  if (input.source === "expected")
    return ran === null ? null : checkedSnapshot(workspace, ran);
  const compiled = await producingProgram(workspace, input.ops);
  if (input.source === "compiled") return compiled;
  if (input.source === "canvas") {
    return ran === compiled &&
      run?.kind === "run" &&
      run.target === input.target
      ? ran
      : null;
  }
  throw new Error(`unknown render source "${input.source}"`);
}
