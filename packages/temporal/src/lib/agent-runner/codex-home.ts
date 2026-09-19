import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prepareProviderWorkspace } from "./provider-workspace.ts";
import {
  prepareProviderHomeParent,
  restoreProviderHomeParentMode,
  type ProviderHomeParentMode,
} from "./provider-home.ts";

export async function restoreCodexSubscriptionParentMode(
  state: ProviderHomeParentMode | undefined,
): Promise<void> {
  await restoreProviderHomeParentMode(state);
}

export async function prepareCodexSubscriptionHome(
  codexHome: string,
  providerUid: number | undefined,
): Promise<ProviderHomeParentMode | undefined> {
  if (
    !path.isAbsolute(codexHome) ||
    path.resolve(codexHome) === path.parse(codexHome).root ||
    path.resolve(codexHome) === path.join(os.homedir(), ".codex")
  ) {
    throw new Error(
      "Subscription CODEX_HOME must be an isolated absolute path",
    );
  }
  const parentMode = await prepareProviderHomeParent(codexHome, providerUid);
  try {
    await mkdir(codexHome, { recursive: true, mode: 0o700 });
    if (await Bun.file(path.join(codexHome, "auth.json")).exists()) {
      throw new Error(
        "Subscription CODEX_HOME must not contain an auth.json file",
      );
    }
    await prepareProviderWorkspace(codexHome, providerUid);
    return parentMode;
  } catch (error: unknown) {
    try {
      await restoreCodexSubscriptionParentMode(parentMode);
    } catch (restoreError: unknown) {
      throw new AggregateError(
        [error],
        "Codex subscription home preparation and parent restoration failed",
        { cause: restoreError },
      );
    }
    throw error;
  }
}

export type CodexOpenRouterHome = {
  environment: Record<string, string>;
  providerHomeDirectory: string | undefined;
  subscriptionHome: string | undefined;
  subscriptionParentMode: ProviderHomeParentMode | undefined;
};

export async function prepareCodexOpenRouterHome(input: {
  environment: Record<string, string>;
  providerUid: number | undefined;
  resumeSessionId: string | undefined;
}): Promise<CodexOpenRouterHome> {
  const configuredCodexHome =
    input.resumeSessionId === undefined
      ? undefined
      : input.environment["CODEX_HOME"];
  const persistentCodexHome =
    configuredCodexHome === "" ? undefined : configuredCodexHome;
  if (
    persistentCodexHome === undefined &&
    input.resumeSessionId !== undefined &&
    input.providerUid !== undefined
  ) {
    throw new Error(
      "Resumed OpenRouter Codex runs require a caller-owned CODEX_HOME",
    );
  }
  if (persistentCodexHome !== undefined) {
    return {
      environment: { HOME: persistentCodexHome },
      providerHomeDirectory: undefined,
      subscriptionHome: persistentCodexHome,
      subscriptionParentMode: await prepareCodexSubscriptionHome(
        persistentCodexHome,
        input.providerUid,
      ),
    };
  }
  if (input.providerUid === undefined) {
    return {
      environment: {},
      providerHomeDirectory: undefined,
      subscriptionHome: undefined,
      subscriptionParentMode: undefined,
    };
  }
  const providerHome = await createCodexProviderHome(input.providerUid);
  return {
    environment: providerHome.environment,
    providerHomeDirectory: providerHome.directory,
    subscriptionHome: undefined,
    subscriptionParentMode: undefined,
  };
}

export async function rollbackCodexOpenRouterHome(
  home: CodexOpenRouterHome,
): Promise<void> {
  try {
    if (home.providerHomeDirectory !== undefined) {
      await rm(home.providerHomeDirectory, { recursive: true, force: true });
    }
    await restoreCodexSubscriptionParentMode(home.subscriptionParentMode);
  } catch (error: unknown) {
    throw new Error("Codex OpenRouter home cleanup failed", { cause: error });
  }
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
