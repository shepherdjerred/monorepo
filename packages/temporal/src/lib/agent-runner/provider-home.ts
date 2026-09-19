import { chmod, mkdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prepareProviderWorkspace } from "./provider-workspace.ts";

export type ProviderHomeParentMode = {
  directory: string;
  mode: number;
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
  const lifecycleStat = await stat(lifecycleDirectory);
  const lifecycleMode = lifecycleStat.mode & 0o7777;
  const providerExecuteBit = providerUid === lifecycleStat.uid ? 0o100 : 0o001;
  if ((lifecycleMode & providerExecuteBit) !== 0) return undefined;
  await chmod(lifecycleDirectory, lifecycleMode | 0o111);
  return { directory: lifecycleDirectory, mode: lifecycleMode };
}

export async function restoreProviderHomeParentMode(
  state: ProviderHomeParentMode | undefined,
): Promise<void> {
  if (state !== undefined) await chmod(state.directory, state.mode);
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
    await restoreProviderHomeParentMode(parentMode);
    throw error;
  }
}
