#!/usr/bin/env bun

/**
 * Buildkite entry point for homelab release admission.
 *
 * The decision lives in scripts/lib/ci/homelab-release-admission-core.ts and
 * is shared with the Woodpecker entry point, so the rule about which build may
 * release cannot drift while both exist. This file is deleted at cutover.
 */

import {
  decideHomelabReleaseAdmission,
  parseHomelabReleaseAdmission,
  resolveOriginMainCommit,
} from "../../../scripts/lib/ci/homelab-release-admission-core.ts";
import { writeJsonHandoff } from "../reporting/buildkite-handoff.ts";
import {
  readHandoffValue,
  readRequiredMetadata,
  requiredArgument,
} from "../reporting/read-buildkite-handoff.ts";

const HANDOFF_KEY = "homelab-release-admission";
const HANDOFF_ARTIFACT = "homelab-release-admission.json";

function requiredEnvironment(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required for homelab release admission`);
  }
  return value;
}

async function admit(): Promise<void> {
  const defaultBranch = Bun.env["BUILDKITE_PIPELINE_DEFAULT_BRANCH"] ?? "main";
  if (requiredEnvironment("BUILDKITE_BRANCH") !== defaultBranch) {
    throw new Error(
      `homelab release admission only supports ${defaultBranch} builds`,
    );
  }
  const buildNumber = Number(requiredEnvironment("BUILDKITE_BUILD_NUMBER"));
  const admission = decideHomelabReleaseAdmission({
    buildCommit: requiredEnvironment("BUILDKITE_COMMIT"),
    currentMainCommit: await resolveOriginMainCommit(defaultBranch),
    buildNumber,
  });
  await writeJsonHandoff(HANDOFF_KEY, HANDOFF_ARTIFACT, admission);
  console.log(
    `homelab release ${admission.outcome}: build ${admission.buildCommit}, current main ${admission.currentMainCommit}`,
  );
}

async function consume(): Promise<void> {
  const raw = await readHandoffValue(await readRequiredMetadata(HANDOFF_KEY));
  const admission = parseHomelabReleaseAdmission(JSON.parse(raw));
  console.log(admission.outcome);
}

async function main(): Promise<void> {
  const command = requiredArgument(
    Bun.argv,
    2,
    "homelab release admission command",
  );
  switch (command) {
    case "admit":
      await admit();
      return;
    case "consume":
      await consume();
      return;
    default:
      throw new Error(`unknown homelab release admission command: ${command}`);
  }
}

if (import.meta.main) await main();
