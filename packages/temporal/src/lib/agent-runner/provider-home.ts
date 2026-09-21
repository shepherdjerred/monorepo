import { chmod, mkdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  prepareProviderWorkspace,
  restoreProviderWorkspace,
} from "./provider-workspace.ts";

export type ProviderHomeParentMode = {
  directories: readonly { directory: string; mode: number }[];
};

export async function prepareProviderHomeParent(
  home: string,
  providerUid: number | undefined,
): Promise<ProviderHomeParentMode | undefined> {
  const lifecycleDirectory = path.dirname(home);
  if (
    providerUid === undefined ||
    lifecycleDirectory === path.parse(lifecycleDirectory).root
  ) {
    return undefined;
  }
  await mkdir(lifecycleDirectory, { recursive: true, mode: 0o700 });
  const directories: { directory: string; mode: number }[] = [];
  try {
    let directory = lifecycleDirectory;
    for (;;) {
      const directoryStat = await stat(directory);
      const mode = directoryStat.mode & 0o7777;
      const providerExecuteBit =
        providerUid === directoryStat.uid ? 0o100 : 0o001;
      if ((mode & providerExecuteBit) === 0) {
        await chmod(directory, mode | 0o111);
        directories.push({ directory, mode });
      }
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  } catch (error: unknown) {
    await restoreProviderHomeParentMode({ directories });
    throw error;
  }
  return directories.length === 0 ? undefined : { directories };
}

export async function restoreProviderHomeParentMode(
  state: ProviderHomeParentMode | undefined,
): Promise<void> {
  if (state !== undefined) {
    for (const directory of state.directories) {
      await chmod(directory.directory, directory.mode);
    }
  }
}

export async function prepareIsolatedProviderHome(
  home: string | undefined,
  providerUid: number | undefined,
): Promise<
  | {
      directory: string;
      parentMode: ProviderHomeParentMode | undefined;
    }
  | undefined
> {
  if (providerUid === undefined) return undefined;
  if (
    home === undefined ||
    !path.isAbsolute(home) ||
    path.resolve(home) === path.parse(home).root ||
    path.resolve(home) === os.homedir()
  ) {
    throw new Error(
      "Provider uid isolation requires an explicit isolated HOME",
    );
  }
  const parentMode = await prepareProviderHomeParent(home, providerUid);
  try {
    await mkdir(home, { recursive: true, mode: 0o700 });
    await prepareProviderWorkspace(home, providerUid);
    return { directory: home, parentMode };
  } catch (error: unknown) {
    const failures: unknown[] = [];
    for (const operation of [
      () => restoreProviderWorkspace(home),
      () => restoreProviderHomeParentMode(parentMode),
    ]) {
      try {
        await operation();
      } catch (restoreError: unknown) {
        failures.push(restoreError);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(
        failures,
        "Provider home preparation rollback failed",
        {
          cause: error,
        },
      );
    throw error;
  }
}
