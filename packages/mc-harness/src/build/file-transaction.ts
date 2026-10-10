import { copyFile, lstat, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { BuildWorkspace } from "./workspace.ts";

type ChangedFile = { file: string; previous: boolean; installed: boolean };

async function exists(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
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
      if (state.installed)
        await rm(workspace.file(state.file), { recursive: true });
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

/** Publish exactly the staged paths, rolling them back if publication or commit fails. */
export async function publishFiles(
  workspace: BuildWorkspace,
  options: {
    prefix: string;
    stage: (dir: string) => Promise<readonly string[]>;
    commit?: () => Promise<unknown>;
  },
): Promise<void> {
  const staged = await mkdtemp(workspace.file(options.prefix));
  const changed: ChangedFile[] = [];
  let cleanup = true;
  try {
    const files = await options.stage(staged);
    for (const file of files) {
      const state = { file, previous: false, installed: false };
      changed.push(state);
      await mkdir(path.dirname(path.join(staged, `previous-${file}`)), {
        recursive: true,
      });
      await mkdir(path.dirname(workspace.file(file)), { recursive: true });
      if (await exists(workspace.file(file))) {
        // Keep ordinary files readable until their atomic replacement, even on process exit.
        const existing = await lstat(workspace.file(file));
        const replacing = await exists(path.join(staged, file));
        const preserve = replacing && existing.isFile() ? copyFile : rename;
        await preserve(
          workspace.file(file),
          path.join(staged, `previous-${file}`),
        );
        state.previous = true;
      }
      if (await exists(path.join(staged, file))) {
        await rename(path.join(staged, file), workspace.file(file));
        state.installed = true;
      }
    }
    await options.commit?.();
  } catch (error) {
    const failures = await rollback(workspace, staged, changed);
    if (failures.length > 0) {
      cleanup = false;
      throw new AggregateError(
        [error, ...failures],
        `file publication failed; recovery files retained at ${staged}`,
        { cause: error },
      );
    }
    throw error;
  } finally {
    if (cleanup) await rm(staged, { recursive: true, force: true });
  }
}
