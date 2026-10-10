import { mkdtemp, rename, rm } from "node:fs/promises";
import path from "node:path";
import { BUILD_FILES } from "#protocol/build.ts";
import type { BuildWorkspace } from "#build/workspace.ts";

type ChangedFile = { file: string; previous: boolean; installed: boolean };

async function install(
  workspace: BuildWorkspace,
  staged: string,
  hasProgram: boolean,
  changed: ChangedFile[],
): Promise<void> {
  for (const file of [BUILD_FILES.program, BUILD_FILES.oplog]) {
    const state = { file, previous: false, installed: false };
    changed.push(state);
    try {
      await rename(workspace.file(file), path.join(staged, `previous-${file}`));
      state.previous = true;
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
    if (hasProgram || file !== BUILD_FILES.program) {
      await rename(path.join(staged, file), workspace.file(file));
      state.installed = true;
    }
  }
}

async function rollback(
  workspace: BuildWorkspace,
  staged: string,
  changed: readonly ChangedFile[],
): Promise<unknown[]> {
  const failures: unknown[] = [];
  for (const state of changed.toReversed()) {
    try {
      if (state.installed) await rm(workspace.file(state.file));
      if (state.previous)
        await rename(
          path.join(staged, `previous-${state.file}`),
          workspace.file(state.file),
        );
    } catch (error) {
      failures.push(error);
    }
  }
  return failures;
}

/** Stage a working version and roll back both files if any rename fails. */
export async function installWorkingFiles(
  workspace: BuildWorkspace,
  input: { program: Uint8Array | null; oplog: string },
): Promise<void> {
  const staged = await mkdtemp(workspace.file(".pick-"));
  const changed: ChangedFile[] = [];
  let cleanup = true;
  try {
    if (input.program !== null)
      await Bun.write(path.join(staged, BUILD_FILES.program), input.program);
    await Bun.write(path.join(staged, BUILD_FILES.oplog), input.oplog);
    await install(workspace, staged, input.program !== null, changed);
  } catch (error) {
    const failures = await rollback(workspace, staged, changed);
    if (failures.length > 0) {
      cleanup = false;
      throw new AggregateError(
        [error, ...failures],
        `candidate restore failed; recovery files retained at ${staged}`,
        { cause: error },
      );
    }
    throw error;
  } finally {
    if (cleanup) await rm(staged, { recursive: true, force: true });
  }
}
