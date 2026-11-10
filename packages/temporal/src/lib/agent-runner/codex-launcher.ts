import type { CodexOptions } from "@openai/codex-sdk";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  providerSubprocessCommand,
  providerSubprocessUid,
} from "#shared/agent/agent-subprocess-identity.ts";
import {
  LinuxSandboxHelperSchema,
  type RunCodexAgentTurnInput,
} from "./contract.ts";
import { materializeCodexBubblewrap } from "./codex-bubblewrap.ts";

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
  bundledBubblewrap: boolean,
): Promise<{ directory: string; executable: string }> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "agent-codex-provider-"),
  );
  try {
    const providerUid = providerSubprocessUid(environment);
    if (providerUid === undefined)
      throw new Error("Isolated Codex launcher requires a provider uid");
    await chmod(directory, 0o755);
    if (bundledBubblewrap) {
      await materializeCodexBubblewrap({
        codexLauncherPath: codexLauncherPath(),
        wrapperDirectory: directory,
      });
    }
    const executable = path.join(directory, "codex");
    const wrappedCommand = providerSubprocessCommand(command, environment)
      .map((part) => shellQuote(part))
      .join(" ");
    const schemaHelper = fileURLToPath(
      new URL("codex-permissions/output-schema.ts", import.meta.url),
    );
    const prepareSchema = [
      "/usr/bin/env",
      "-i",
      `HOME=${directory}`,
      `XDG_CONFIG_HOME=${directory}`,
      process.execPath,
      "--no-env-file",
      "--no-install",
      "--no-macros",
      "--config=/dev/null",
      schemaHelper,
      providerUid.toString(),
      os.tmpdir(),
    ]
      .map((part) => shellQuote(part))
      .join(" ");
    await writeFile(
      executable,
      `#!/bin/sh\n(cd ${shellQuote(path.dirname(schemaHelper))} && exec ${prepareSchema} "$@") || exit $?\n${bundledBubblewrap ? `PATH=${shellQuote(directory)}:"$PATH" ` : ""}exec ${wrappedCommand} "$@"\n`,
      {
        encoding: "utf8",
        mode: 0o755,
      },
    );
    await chmod(executable, 0o755);
    return { directory, executable };
  } catch (error: unknown) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function providerPathOverride(
  input: Pick<
    RunCodexAgentTurnInput,
    "codexPathOverride" | "linuxSandboxHelper"
  > &
    Partial<Pick<RunCodexAgentTurnInput, "env">>,
): Promise<{
  pathOverride: Pick<CodexOptions, "codexPathOverride"> | undefined;
  wrapperDirectory: string | undefined;
}> {
  const providerUid = providerSubprocessUid();
  const helper = LinuxSandboxHelperSchema.optional().parse(
    input.linuxSandboxHelper,
  );
  if (helper !== undefined) {
    if (input.codexPathOverride !== undefined)
      throw new Error(
        "Bundled Codex bubblewrap cannot use a custom Codex executable",
      );
    if (
      providerUid === undefined ||
      process.platform !== "linux" ||
      process.getuid?.() !== 0
    )
      throw new Error(
        "Bundled Codex bubblewrap requires an isolated provider UID and Linux root parent",
      );
    if (input.env?.["PATH"] === undefined || input.env["PATH"] === "")
      throw new Error(
        "Bundled Codex bubblewrap requires the original provider PATH",
      );
  }
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
  const wrapper = await materializeProviderWrapper(
    command,
    {
      AGENT_PROVIDER_UID: providerUid.toString(),
    },
    helper !== undefined,
  );
  return {
    pathOverride: { codexPathOverride: wrapper.executable },
    wrapperDirectory: wrapper.directory,
  };
}
