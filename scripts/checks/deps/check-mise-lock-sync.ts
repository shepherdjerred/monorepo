#!/usr/bin/env bun

/**
 * mise lockfile sync checker.
 *
 * CI installs tools with `MISE_LOCKED=1` so mise uses the URLs and checksums
 * `mise.lock` records instead of resolving versions through api.github.com,
 * whose quota CI and agents share. Renovate (Mend-hosted, no post-upgrade
 * commands) bumps `.mise.toml` without relocking, so this check fails a PR
 * whose lockfile no longer covers the configured tools on every runner
 * platform, and names the relock command, before a CI image bake or a stale
 * toolchain step fails on the missing entry.
 *
 * It also keeps the mise release that bootstraps stale images in
 * `ci/scripts/toolchain.sh` equal to the ci-base pin: a mise older than a
 * lockfile's format refuses to read it.
 */

import { z } from "zod";

export const LOCK_PLATFORMS = ["linux-x64", "macos-arm64"] as const;
export const RELOCK_COMMAND = `mise lock --platform ${LOCK_PLATFORMS.join(",")}`;

const MISE_TOML_PATH = ".mise.toml";
const MISE_LOCK_PATH = "mise.lock";
const CI_IMAGE_DOCKERFILE = "ci/ci-image/Dockerfile";
const TOOLCHAIN_SCRIPT = "ci/scripts/toolchain.sh";

const ToolRequestSchema = z.union([
  z.string(),
  z.object({ version: z.string() }).loose(),
]);
const MiseTomlSchema = z.object({
  tools: z.record(z.string(), ToolRequestSchema),
});
const LockEntrySchema = z
  .object({
    version: z.string(),
    backend: z.string(),
    specifiers: z.array(z.string()).optional(),
  })
  .loose();
const MiseLockSchema = z.object({
  lockfile_version: z.number().int(),
  tools: z.record(z.string(), z.array(LockEntrySchema)),
});

export type Violation = { file: string; message: string };

function requestedVersion(request: z.infer<typeof ToolRequestSchema>): string {
  return typeof request === "string" ? request : request.version;
}

function platformKeys(entry: Record<string, unknown>): string[] {
  return Object.keys(entry)
    .filter((key) => key.startsWith("platforms."))
    .map((key) => key.slice("platforms.".length));
}

/**
 * Lockfile coverage violations for parsed `.mise.toml` and `mise.lock`.
 * Every configured tool needs an entry bound to its requested version. An
 * entry that records artifacts must record them for every runner platform;
 * cargo, dotnet, and core:rust entries record only a version, which locked
 * mode accepts. Entries for tools no longer configured are stale.
 */
export function lockViolations(
  miseToml: unknown,
  miseLock: unknown,
): Violation[] {
  const { tools } = MiseTomlSchema.parse(miseToml);
  const lock = MiseLockSchema.parse(miseLock);
  const violations: Violation[] = [];
  for (const [name, request] of Object.entries(tools)) {
    const version = requestedVersion(request);
    const entries = lock.tools[name] ?? [];
    const entry = entries.find(
      (candidate) =>
        candidate.version === version ||
        (candidate.specifiers ?? []).includes(version),
    );
    if (entry === undefined) {
      violations.push({
        file: MISE_LOCK_PATH,
        message: `${name} = "${version}" has no lock entry`,
      });
      continue;
    }
    const platforms = platformKeys(entry);
    if (platforms.length === 0) continue;
    const missing = LOCK_PLATFORMS.filter(
      (platform) => !platforms.includes(platform),
    );
    if (missing.length > 0) {
      violations.push({
        file: MISE_LOCK_PATH,
        message: `${name}@${entry.version} has no artifact for ${missing.join(", ")}`,
      });
    }
  }
  for (const name of Object.keys(lock.tools)) {
    if (!(name in tools)) {
      violations.push({
        file: MISE_LOCK_PATH,
        message: `${name} is locked but no longer configured`,
      });
    }
  }
  return violations;
}

/** The ci-base and stale-image bootstrap must run the same mise release. */
export function bootstrapViolations(
  dockerfile: string,
  toolchain: string,
): Violation[] {
  const imagePin = /^ARG MISE_VERSION=(\S+)$/mu.exec(dockerfile)?.[1];
  const bootstrapPin = /^MISE_BOOTSTRAP_VERSION="([^"]+)"$/mu.exec(
    toolchain,
  )?.[1];
  if (imagePin === undefined) {
    return [
      { file: CI_IMAGE_DOCKERFILE, message: "no ARG MISE_VERSION found" },
    ];
  }
  if (bootstrapPin === undefined) {
    return [
      { file: TOOLCHAIN_SCRIPT, message: "no MISE_BOOTSTRAP_VERSION found" },
    ];
  }
  if (imagePin === bootstrapPin) return [];
  return [
    {
      file: TOOLCHAIN_SCRIPT,
      message: `MISE_BOOTSTRAP_VERSION="${bootstrapPin}" does not match ${CI_IMAGE_DOCKERFILE}'s ARG MISE_VERSION=${imagePin}`,
    },
  ];
}

async function main(): Promise<void> {
  const violations = [
    ...lockViolations(
      Bun.TOML.parse(await Bun.file(MISE_TOML_PATH).text()),
      Bun.TOML.parse(await Bun.file(MISE_LOCK_PATH).text()),
    ),
    ...bootstrapViolations(
      await Bun.file(CI_IMAGE_DOCKERFILE).text(),
      await Bun.file(TOOLCHAIN_SCRIPT).text(),
    ),
  ];
  if (violations.length > 0) {
    console.error("mise lockfile sync violations:\n");
    for (const violation of violations) {
      console.error(`  ${violation.file}`);
      console.error(`    ${violation.message}\n`);
    }
    console.error(
      `${String(violations.length)} violation(s) found. Relock at the repository root with:\n  ${RELOCK_COMMAND}`,
    );
    process.exit(1);
  }
  console.log("mise.lock covers every configured tool on every CI platform.");
}

if (import.meta.main) await main();
