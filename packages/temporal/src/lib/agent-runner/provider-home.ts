import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prepareProviderWorkspace } from "./provider-workspace.ts";

export async function prepareIsolatedProviderHome(
  home: string | undefined,
  providerUid: number | undefined,
): Promise<string | undefined> {
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
  await mkdir(home, { recursive: true, mode: 0o700 });
  await prepareProviderWorkspace(home, providerUid);
  return home;
}
