#!/usr/bin/env bun

/**
 * Toolchain version-sync checker.
 *
 * The macOS/Windows cross-compiler Dockerfiles hardcode their own copies of
 * the Rust and .NET SDK versions (documented in-file as "must match
 * .mise.toml" / "must match global.json") instead of reading the
 * repo-authoritative values. Renovate updates `.mise.toml` (native `mise`
 * manager) and `global.json` (native dotnet-sdk manager) independently —
 * nothing keeps the Dockerfile copies in sync, and nothing previously failed
 * CI when they drifted. This check makes that drift fail loudly instead of
 * silently building a cross-compiler image against a stale toolchain.
 */

import { z } from "zod";
import mise from "../../../.mise.toml";

const MiseToolsSchema = z.object({
  tools: z.object({
    rust: z.string(),
    dotnet: z.string(),
  }),
});

const GlobalJsonSchema = z.object({
  sdk: z.object({
    version: z.string(),
  }),
});

type Violation = {
  file: string;
  message: string;
};

const MISE_TOML_PATH = ".mise.toml";
const GLOBAL_JSON_PATH = "global.json";
const MACOS_DOCKERFILE = "packages/macos-cross-compiler/Dockerfile";
const WINDOWS_DOCKERFILE = "packages/windows-cross-compiler/Dockerfile";

function extractArg(source: string, argName: string): string | undefined {
  const match = new RegExp(
    String.raw`ARG\s+${argName}=([0-9][a-zA-Z0-9._-]*)`,
  ).exec(source);
  return match?.[1];
}

async function main(): Promise<void> {
  const violations: Violation[] = [];

  const { tools } = MiseToolsSchema.parse(mise);
  const miseRust = tools.rust;
  const miseDotnet = tools.dotnet;

  const globalJson = GlobalJsonSchema.parse(
    await Bun.file(GLOBAL_JSON_PATH).json(),
  );
  const globalJsonDotnet = globalJson.sdk.version;

  const macosSource = await Bun.file(MACOS_DOCKERFILE).text();
  const windowsSource = await Bun.file(WINDOWS_DOCKERFILE).text();

  const macosRust = extractArg(macosSource, "RUST_VERSION");
  const windowsRust = extractArg(windowsSource, "RUST_VERSION");
  const windowsDotnet = extractArg(windowsSource, "DOTNET_SDK_VERSION");

  if (macosRust === undefined) {
    violations.push({
      file: MACOS_DOCKERFILE,
      message: "no ARG RUST_VERSION found",
    });
  } else if (macosRust !== miseRust) {
    violations.push({
      file: MACOS_DOCKERFILE,
      message: `ARG RUST_VERSION=${macosRust} does not match ${MISE_TOML_PATH}'s rust = "${miseRust}"`,
    });
  }

  if (windowsRust === undefined) {
    violations.push({
      file: WINDOWS_DOCKERFILE,
      message: "no ARG RUST_VERSION found",
    });
  } else if (windowsRust !== miseRust) {
    violations.push({
      file: WINDOWS_DOCKERFILE,
      message: `ARG RUST_VERSION=${windowsRust} does not match ${MISE_TOML_PATH}'s rust = "${miseRust}"`,
    });
  }

  if (windowsDotnet === undefined) {
    violations.push({
      file: WINDOWS_DOCKERFILE,
      message: "no ARG DOTNET_SDK_VERSION found",
    });
  } else if (windowsDotnet !== miseDotnet) {
    violations.push({
      file: WINDOWS_DOCKERFILE,
      message: `ARG DOTNET_SDK_VERSION=${windowsDotnet} does not match ${MISE_TOML_PATH}'s dotnet = "${miseDotnet}"`,
    });
  }

  if (globalJsonDotnet !== miseDotnet) {
    violations.push({
      file: GLOBAL_JSON_PATH,
      message: `sdk.version = "${globalJsonDotnet}" does not match ${MISE_TOML_PATH}'s dotnet = "${miseDotnet}"`,
    });
  }

  if (violations.length > 0) {
    console.error("Toolchain version-sync violations:\n");
    for (const v of violations) {
      console.error(`  ${v.file}`);
      console.error(`    ${v.message}\n`);
    }
    console.error(`${String(violations.length)} violation(s) found.`);
    process.exit(1);
  }

  console.log(
    `Toolchain versions in sync: rust=${miseRust}, dotnet=${miseDotnet}.`,
  );
}

await main();
