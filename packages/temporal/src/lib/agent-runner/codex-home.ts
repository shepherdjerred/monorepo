import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  prepareProviderWorkspace,
  restoreProviderWorkspace,
} from "./provider-workspace.ts";
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
    const failures: unknown[] = [];
    for (const operation of [
      () => restoreProviderWorkspace(codexHome),
      () => restoreCodexSubscriptionParentMode(parentMode),
    ]) {
      try {
        await operation();
      } catch (restoreError: unknown) {
        failures.push(restoreError);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(
        [error, ...failures],
        "Codex subscription home preparation and parent restoration failed",
        { cause: error },
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
  const configuredCodexHome = input.environment["CODEX_HOME"];
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
  const failures: unknown[] = [];
  for (const operation of [
    async () => {
      if (home.providerHomeDirectory !== undefined) {
        await rm(home.providerHomeDirectory, { recursive: true, force: true });
      }
    },
    async () => {
      if (home.subscriptionHome !== undefined) {
        await restoreProviderWorkspace(home.subscriptionHome);
      }
    },
    () => restoreCodexSubscriptionParentMode(home.subscriptionParentMode),
  ]) {
    try {
      await operation();
    } catch (error: unknown) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    const firstFailure = failures[0];
    if (firstFailure === undefined)
      throw new Error("Codex OpenRouter home cleanup failed without an error");
    throw new Error("Codex OpenRouter home cleanup failed", {
      cause:
        failures.length === 1
          ? firstFailure
          : new AggregateError(
              failures,
              "Codex OpenRouter home cleanup had multiple failures",
            ),
    });
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
