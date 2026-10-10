import {
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { BuildWorkspace } from "./workspace.ts";
import { withPublicationLock } from "#protocol/publication-lock.ts";

type PublicationOptions = {
  prefix: string;
  stage: (dir: string) => Promise<readonly string[]>;
  exclusive?: readonly string[];
};

type ChangedFile = { file: string; previous: boolean; installed: boolean };
type TransactionFile = { file: string; publish: boolean };
type Transaction = { files: TransactionFile[] };
const TransactionSchema = z.strictObject({
  files: z.array(
    z.strictObject({ file: z.string().min(1), publish: z.boolean() }),
  ),
});

const TRANSACTION_FILE = ".transaction.json";
const COMMITTED_FILE = ".committed";
const RECOVERED_FILE = ".recovered";
const TRANSACTION_DIR =
  /^\.(?:capture|compile|run|pick|render|critique-publish|bout)-/u;

function transactionPath(root: string, file: string): string {
  if (
    path.isAbsolute(file) ||
    file.split(path.sep).includes("..") ||
    path.normalize(file).startsWith(`..${path.sep}`)
  )
    throw new Error(`invalid publication path: ${file}`);
  return path.join(root, file);
}

async function recoverInterrupted(workspace: BuildWorkspace): Promise<void> {
  const entries = await readdir(workspace.dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !TRANSACTION_DIR.test(entry.name)) continue;
    await recoverTransaction(workspace, workspace.file(entry.name));
  }
}

async function recoverTransaction(
  workspace: BuildWorkspace,
  staged: string,
): Promise<void> {
  if (
    (await exists(path.join(staged, COMMITTED_FILE))) ||
    (await exists(path.join(staged, RECOVERED_FILE)))
  ) {
    await rm(staged, { recursive: true, force: true });
    return;
  }
  const marker = Bun.file(path.join(staged, TRANSACTION_FILE));
  if (!(await marker.exists())) {
    // A process can exit while staging, before it touches active files.
    await rm(staged, { recursive: true, force: true });
    return;
  }
  const transaction = TransactionSchema.parse(await marker.json());
  for (const { file, publish } of transaction.files.toReversed()) {
    const target = transactionPath(workspace.dir, file);
    const previous = transactionPath(staged, `previous-${file}`);
    const pending = transactionPath(staged, file);
    if (await exists(previous)) await restorePrevious(previous, target);
    else if (publish && !(await exists(pending)))
      await rm(target, { recursive: true, force: true });
  }
  await Bun.write(path.join(staged, `${RECOVERED_FILE}.pending`), "\n");
  await rename(
    path.join(staged, `${RECOVERED_FILE}.pending`),
    path.join(staged, RECOVERED_FILE),
  );
  await rm(staged, { recursive: true, force: true });
}

async function restorePrevious(
  previous: string,
  target: string,
): Promise<void> {
  const restoring = `${target}.recovery`;
  await rm(restoring, { recursive: true, force: true });
  await mkdir(path.dirname(target), { recursive: true });
  await cp(previous, restoring, { recursive: true });
  await rm(target, { recursive: true, force: true });
  await rename(restoring, target);
}

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
      if (state.previous) {
        const previous = path.join(staged, `previous-${state.file}`);
        const target = workspace.file(state.file);
        await restorePrevious(previous, target);
      }
    } catch (error) {
      failures.push(error);
    }
  }
  return failures;
}

/** Preserve a replacement's original path until its staged bytes are ready. */
async function preservePrevious(
  workspace: BuildWorkspace,
  staged: string,
  file: string,
  exclusive: readonly string[],
): Promise<boolean> {
  if (!(await exists(workspace.file(file)))) return false;
  if (exclusive.includes(file))
    throw new Error(`file already exists: ${workspace.file(file)}`);
  // Keep ordinary files readable until their atomic replacement, even on process exit.
  const existing = await lstat(workspace.file(file));
  const replacing = await exists(path.join(staged, file));
  if (replacing && existing.isFile()) {
    const previous = path.join(staged, `previous-${file}`);
    const temporary = `${previous}.pending`;
    await copyFile(workspace.file(file), temporary);
    await rename(temporary, previous);
  } else {
    await rename(workspace.file(file), path.join(staged, `previous-${file}`));
  }
  return true;
}

/** Publish exactly the staged paths, rolling them back if installation fails. */
export async function publishFiles(
  workspace: BuildWorkspace,
  options: PublicationOptions,
): Promise<void> {
  await withPublicationLock(workspace.dir, async () => {
    await recoverInterrupted(workspace);
    await publishStaged(workspace, options);
  });
}

async function publishStaged(
  workspace: BuildWorkspace,
  options: PublicationOptions,
): Promise<void> {
  const staged = await mkdtemp(workspace.file(options.prefix));
  const changed: ChangedFile[] = [];
  let cleanup = true;
  try {
    const files = await options.stage(staged);
    const transaction: Transaction = {
      files: await Promise.all(
        files.map(async (file) => ({
          file,
          publish: await exists(transactionPath(staged, file)),
        })),
      ),
    };
    await Bun.write(
      path.join(staged, TRANSACTION_FILE),
      `${JSON.stringify(transaction)}\n`,
    );
    for (const file of files) {
      const state = { file, previous: false, installed: false };
      changed.push(state);
      await mkdir(path.dirname(path.join(staged, `previous-${file}`)), {
        recursive: true,
      });
      await mkdir(path.dirname(workspace.file(file)), { recursive: true });
      state.previous = await preservePrevious(
        workspace,
        staged,
        file,
        options.exclusive ?? [],
      );
      if (
        transaction.files.find((item) => item.file === file)?.publish === true
      ) {
        await rename(
          transactionPath(staged, file),
          transactionPath(workspace.dir, file),
        );
        state.installed = true;
      }
    }
    await Bun.write(path.join(staged, `${COMMITTED_FILE}.pending`), "\n");
    await rename(
      path.join(staged, `${COMMITTED_FILE}.pending`),
      path.join(staged, COMMITTED_FILE),
    );
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
