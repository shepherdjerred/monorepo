import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prepareProviderWorkspace } from "./provider-workspace.ts";

export async function prepareCodexSubscriptionHome(
  codexHome: string,
  providerUid: number | undefined,
): Promise<void> {
  if (
    !path.isAbsolute(codexHome) ||
    path.resolve(codexHome) === path.parse(codexHome).root ||
    path.resolve(codexHome) === path.join(os.homedir(), ".codex")
  ) {
    throw new Error(
      "Subscription CODEX_HOME must be an isolated absolute path",
    );
  }
  await mkdir(codexHome, { recursive: true, mode: 0o700 });
  if (await Bun.file(path.join(codexHome, "auth.json")).exists()) {
    throw new Error(
      "Subscription CODEX_HOME must not contain an auth.json file",
    );
  }
  await prepareProviderWorkspace(codexHome, providerUid);
}

export async function createCodexProviderHome(providerUid: number): Promise<{
  directory: string;
  environment: { HOME: string; CODEX_HOME: string };
}> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-codex-home-"));
  try {
    // The worker owns the lifecycle directory; the provider can traverse it.
    await chmod(directory, 0o755);
    const home = path.join(directory, "home");
    const codexHome = path.join(home, ".codex");
    await mkdir(codexHome, { recursive: true, mode: 0o700 });
    await prepareProviderWorkspace(home, providerUid);
    return { directory, environment: { HOME: home, CODEX_HOME: codexHome } };
  } catch (error: unknown) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
