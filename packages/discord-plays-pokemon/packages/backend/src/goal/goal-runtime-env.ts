// Builds the runtime environment for the Codex subprocess. Two things matter:
// (1) write the `pokemonctl` shell wrapper into a runtime helper directory so
// PATH lookup finds it, and (2) build a deliberately minimal env so a
// prompt-injected goal can't exfiltrate unrelated process secrets.
// Extracted from goal-manager.ts to keep that file under the 500-line cap.

import path from "node:path";
import { buildCodexCredentialEnvironment } from "./codex-auth.ts";

// Only these variables are forwarded to the Codex subprocess. The goal text
// is attacker-controlled and Codex can read its own environment, so the
// subprocess must never inherit unrelated process secrets (DISCORD_TOKEN,
// etc.) that a prompt-injected goal could exfiltrate via `pokemonctl progress`.
// PATH/POKEMONCTL_* are injected explicitly below.
const INHERITED_ENVIRONMENT_ALLOWLIST = [
  "PATH",
  "HOME",
  "CODEX_HOME",
  "CODEX_API_KEY",
  "CODEX_ACCESS_TOKEN",
  "OPENAI_API_KEY",
];

export async function prepareRuntimeTools(
  runtimeDirectory: string,
): Promise<string> {
  const helperDirectory = path.join(runtimeDirectory, ".pokemon-goal-bin");
  const helperPath = path.join(helperDirectory, "pokemonctl");
  await Bun.write(
    helperPath,
    ["#!/bin/sh", 'exec bun "$POKEMONCTL_SCRIPT" "$@"', ""].join("\n"),
    { createPath: true },
  );

  const chmod = Bun.spawn(["chmod", "0755", helperPath], {
    stdout: "ignore",
    stderr: "pipe",
  });
  const exitCode = await chmod.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(chmod.stderr).text();
    throw new Error(`Failed to prepare pokemonctl wrapper: ${stderr}`);
  }

  return helperDirectory;
}

export type BuildEnvironmentInput = {
  runtimeDirectory: string;
  helperDirectory: string;
  controlHost: string;
  controlPort: number;
  controlToken: string;
};

export function buildEnvironment(
  input: BuildEnvironmentInput,
): Record<string, string> {
  const inherited: Record<string, string> = {};
  for (const key of INHERITED_ENVIRONMENT_ALLOWLIST) {
    const value = Bun.env[key];
    if (value !== undefined && value.length > 0) {
      inherited[key] = value;
    }
  }

  const inheritedPath = Bun.env.PATH;
  const pathParts = [
    input.helperDirectory,
    path.join(input.runtimeDirectory, "node_modules", ".bin"),
    path.join(
      input.runtimeDirectory,
      "packages",
      "backend",
      "node_modules",
      ".bin",
    ),
  ].filter((entry) => entry.length > 0);
  if (inheritedPath !== undefined && inheritedPath.length > 0) {
    pathParts.push(inheritedPath);
  }

  const codexCredentialEnvironment = buildCodexCredentialEnvironment(inherited);

  return {
    ...inherited,
    ...codexCredentialEnvironment,
    PATH: pathParts.join(":"),
    POKEMONCTL_URL: `http://${input.controlHost}:${String(input.controlPort)}`,
    POKEMONCTL_TOKEN: input.controlToken,
    POKEMONCTL_SCRIPT: path.join(
      input.runtimeDirectory,
      "packages",
      "backend",
      "src",
      "goal",
      "pokemonctl.ts",
    ),
  };
}
