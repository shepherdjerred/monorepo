import type { CodexOptions } from "@openai/codex-sdk";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  providerSubprocessCommand,
  providerSubprocessUid,
} from "#shared/agent/agent-subprocess-identity.ts";
import type { RunCodexAgentTurnInput } from "./contract.ts";

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function codexLauncherPath(): string {
  const sdkEntry = Bun.resolveSync(
    "@openai/codex-sdk",
    path.dirname(fileURLToPath(import.meta.url)),
  );
  const sdkPackageDirectory = path.dirname(path.dirname(sdkEntry));
  return path.join(
    path.dirname(sdkPackageDirectory),
    "codex",
    "bin",
    "codex.js",
  );
}

async function materializeProviderWrapper(
  command: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): Promise<{ directory: string; executable: string }> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "agent-codex-provider-"),
  );
  try {
    await chmod(directory, 0o755);
    const executable = path.join(directory, "codex");
    const wrappedCommand = providerSubprocessCommand(command, environment)
      .map((part) => shellQuote(part))
      .join(" ");
    await writeFile(executable, `#!/bin/sh\nexec ${wrappedCommand} "$@"\n`, {
      encoding: "utf8",
      mode: 0o755,
    });
    await chmod(executable, 0o755);
    return { directory, executable };
  } catch (error: unknown) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function providerPathOverride(
  input: RunCodexAgentTurnInput,
): Promise<{
  pathOverride: Pick<CodexOptions, "codexPathOverride"> | undefined;
  wrapperDirectory: string | undefined;
}> {
  const providerUid = providerSubprocessUid();
  if (providerUid === undefined)
    return {
      pathOverride:
        input.codexPathOverride === undefined
          ? undefined
          : { codexPathOverride: input.codexPathOverride },
      wrapperDirectory: undefined,
    };
  const command =
    input.codexPathOverride === undefined
      ? [process.execPath, codexLauncherPath()]
      : [input.codexPathOverride];
  const wrapper = await materializeProviderWrapper(command, {
    AGENT_PROVIDER_UID: providerUid.toString(),
  });
  return {
    pathOverride: { codexPathOverride: wrapper.executable },
    wrapperDirectory: wrapper.directory,
  };
}
