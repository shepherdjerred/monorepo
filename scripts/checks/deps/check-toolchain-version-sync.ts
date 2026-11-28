#!/usr/bin/env bun

/**
 * Toolchain version-sync checker.
 *
 * The macOS/Windows cross-compiler Dockerfiles hardcode their own copies of
 * the Rust and .NET SDK versions (documented in-file as "must match
 * .mise.toml" / "must match global.json") instead of reading the
 * repo-authoritative values. Renovate groups each set into one branch (the
 * "Rust toolchain", ".NET SDK" and "OpenTofu" rules in renovate.json), but a
 * hand edit, or a copy a group rule does not match, can still drift. This
 * check makes that drift fail loudly instead of silently building an image
 * against a stale toolchain.
 *
 * The Temporal worker image pins operator CLIs (`TOFU_VERSION`,
 * `ARGOCD_CLI_VERSION`, `GH_CLI_VERSION`, `TEMPORAL_CLI_VERSION`,
 * `LYCHEE_VERSION`, and `POSTGRESQL_BINARIES_VERSION`) that must stay aligned
 * with `.mise.toml` so local runs, CI, and scheduled workflows execute the
 * same releases.
 */

import path from "node:path";
import { z } from "zod";

const MiseVersionEntrySchema = z.union([
  z.string(),
  z.object({ version: z.string() }),
]);

export const MiseToolsSchema = z.object({
  tools: z.object({
    rust: z.string(),
    dotnet: z.string(),
    opentofu: z.string(),
    argocd: z.string(),
    gh: z.string(),
    lychee: z.string(),
    "aqua:temporalio/cli": z.string(),
    "github:theseus-rs/postgresql-binaries": MiseVersionEntrySchema,
  }),
});

export const GlobalJsonSchema = z.object({
  sdk: z.object({
    version: z.string(),
  }),
});

export type ToolchainViolation = {
  file: string;
  message: string;
};

export type ToolchainSyncInputs = {
  miseConfig: unknown;
  globalJson: unknown;
  macosDockerfile: string;
  windowsDockerfile: string;
  temporalDockerfile: string;
};

export const MISE_TOML_PATH = ".mise.toml";
export const GLOBAL_JSON_PATH = "global.json";
export const MACOS_DOCKERFILE = "packages/macos-cross-compiler/Dockerfile";
export const WINDOWS_DOCKERFILE = "packages/windows-cross-compiler/Dockerfile";
export const TEMPORAL_DOCKERFILE = "packages/temporal/Dockerfile";

export function extractArg(
  source: string,
  argName: string,
): string | undefined {
  const match = new RegExp(
    String.raw`^\s*ARG\s+${argName}=([a-zA-Z0-9][a-zA-Z0-9._-]*)`,
    "m",
  ).exec(source);
  return match?.[1];
}

function resolveMiseEntryVersion(
  entry: z.infer<typeof MiseVersionEntrySchema>,
): string {
  return typeof entry === "string" ? entry : entry.version;
}

function checkDockerArg(
  violations: ToolchainViolation[],
  options: {
    file: string;
    source: string;
    argName: string;
    expectedValue: string;
    miseLabel: string;
    requireDefinedMessage?: boolean;
  },
): void {
  const actual = extractArg(options.source, options.argName);
  if (actual === undefined && options.requireDefinedMessage === true) {
    violations.push({
      file: options.file,
      message: `no ARG ${options.argName} found`,
    });
    return;
  }
  if (actual !== options.expectedValue) {
    violations.push({
      file: options.file,
      message: `ARG ${options.argName}=${actual ?? "<missing>"} does not match ${MISE_TOML_PATH}'s ${options.miseLabel}`,
    });
  }
}

export function validateToolchainVersionSync(
  inputs: ToolchainSyncInputs,
): ToolchainViolation[] {
  const violations: ToolchainViolation[] = [];
  const { tools } = MiseToolsSchema.parse(inputs.miseConfig);
  const globalJson = GlobalJsonSchema.parse(inputs.globalJson);

  checkDockerArg(violations, {
    file: MACOS_DOCKERFILE,
    source: inputs.macosDockerfile,
    argName: "RUST_VERSION",
    expectedValue: tools.rust,
    miseLabel: `rust = "${tools.rust}"`,
    requireDefinedMessage: true,
  });

  checkDockerArg(violations, {
    file: WINDOWS_DOCKERFILE,
    source: inputs.windowsDockerfile,
    argName: "RUST_VERSION",
    expectedValue: tools.rust,
    miseLabel: `rust = "${tools.rust}"`,
    requireDefinedMessage: true,
  });

  checkDockerArg(violations, {
    file: WINDOWS_DOCKERFILE,
    source: inputs.windowsDockerfile,
    argName: "DOTNET_SDK_VERSION",
    expectedValue: tools.dotnet,
    miseLabel: `dotnet = "${tools.dotnet}"`,
    requireDefinedMessage: true,
  });

  const postgresVersion = resolveMiseEntryVersion(
    tools["github:theseus-rs/postgresql-binaries"],
  );
  const temporalChecks: {
    argName: string;
    expectedValue: string;
    miseLabel: string;
  }[] = [
    {
      argName: "TOFU_VERSION",
      expectedValue: tools.opentofu,
      miseLabel: `opentofu = "${tools.opentofu}"`,
    },
    {
      argName: "ARGOCD_CLI_VERSION",
      expectedValue: `v${tools.argocd}`,
      miseLabel: `argocd = "${tools.argocd}" (expected v${tools.argocd})`,
    },
    {
      argName: "GH_CLI_VERSION",
      expectedValue: tools.gh,
      miseLabel: `gh = "${tools.gh}"`,
    },
    {
      argName: "TEMPORAL_CLI_VERSION",
      expectedValue: tools["aqua:temporalio/cli"],
      miseLabel: `"aqua:temporalio/cli" = "${tools["aqua:temporalio/cli"]}"`,
    },
    {
      argName: "LYCHEE_VERSION",
      expectedValue: `lychee-v${tools.lychee}`,
      miseLabel: `lychee = "${tools.lychee}" (expected lychee-v${tools.lychee})`,
    },
    {
      argName: "POSTGRESQL_BINARIES_VERSION",
      expectedValue: postgresVersion,
      miseLabel: `"github:theseus-rs/postgresql-binaries" = "${postgresVersion}"`,
    },
  ];

  for (const check of temporalChecks) {
    checkDockerArg(violations, {
      file: TEMPORAL_DOCKERFILE,
      source: inputs.temporalDockerfile,
      argName: check.argName,
      expectedValue: check.expectedValue,
      miseLabel: check.miseLabel,
    });
  }

  if (globalJson.sdk.version !== tools.dotnet) {
    violations.push({
      file: GLOBAL_JSON_PATH,
      message: `sdk.version = "${globalJson.sdk.version}" does not match ${MISE_TOML_PATH}'s dotnet = "${tools.dotnet}"`,
    });
  }

  return violations;
}

export async function loadAndValidateToolchainSync(
  repoRoot = path.resolve(import.meta.dir, "../../.."),
): Promise<{
  tools: z.infer<typeof MiseToolsSchema>["tools"];
  violations: ToolchainViolation[];
}> {
  const [
    miseSource,
    globalJsonRaw,
    macosDockerfile,
    windowsDockerfile,
    temporalDockerfile,
  ] = await Promise.all([
    Bun.file(path.join(repoRoot, MISE_TOML_PATH)).text(),
    Bun.file(path.join(repoRoot, GLOBAL_JSON_PATH)).text(),
    Bun.file(path.join(repoRoot, MACOS_DOCKERFILE)).text(),
    Bun.file(path.join(repoRoot, WINDOWS_DOCKERFILE)).text(),
    Bun.file(path.join(repoRoot, TEMPORAL_DOCKERFILE)).text(),
  ]);
  const miseConfig = MiseToolsSchema.parse(Bun.TOML.parse(miseSource));
  const globalJson = GlobalJsonSchema.parse(JSON.parse(globalJsonRaw));
  const violations = validateToolchainVersionSync({
    miseConfig,
    globalJson,
    macosDockerfile,
    windowsDockerfile,
    temporalDockerfile,
  });
  return { tools: miseConfig.tools, violations };
}

export function formatToolchainReport(
  tools: z.infer<typeof MiseToolsSchema>["tools"],
  violations: readonly ToolchainViolation[],
): { ok: boolean; output: string } {
  if (violations.length > 0) {
    const lines = ["Toolchain version-sync violations:\n"];
    for (const v of violations) {
      lines.push(`  ${v.file}`, `    ${v.message}\n`);
    }
    lines.push(`${String(violations.length)} violation(s) found.`);
    return { ok: false, output: lines.join("\n") };
  }
  return {
    ok: true,
    output: `Toolchain versions in sync: rust=${tools.rust}, dotnet=${tools.dotnet}, opentofu=${tools.opentofu}, argocd=${tools.argocd}.`,
  };
}

async function main(): Promise<void> {
  const { tools, violations } = await loadAndValidateToolchainSync();
  const report = formatToolchainReport(tools, violations);
  if (!report.ok) {
    console.error(report.output);
    process.exit(1);
  }
  console.log(report.output);
}

if (import.meta.main) {
  await main();
}
