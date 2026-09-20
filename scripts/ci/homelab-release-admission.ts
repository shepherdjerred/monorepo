#!/usr/bin/env bun

/**
 * Decide, and later report, whether this build may release the homelab.
 *
 * Successor to `ci/scripts/admission/homelab-release-admission.ts`.
 * The decision itself is shared with that script; only the transport differs,
 * so the two cannot drift on the rule while both exist.
 *
 * `admit` runs once early on the default branch and publishes the verdict.
 * Every step that mutates live infrastructure calls `consume` first and stops
 * if this build has been superseded -- that is what keeps a slow build from
 * applying a revision newer commits have already moved past.
 */

import {
  decideHomelabReleaseAdmission,
  parseHomelabReleaseAdmission,
  resolveOriginMainCommit,
  HOMELAB_RELEASE_ADMISSION_KEY,
} from "../lib/ci/homelab-release-admission-core.ts";
import { readRequiredHandoff, writeJsonHandoff } from "../lib/ci/ci-handoff.ts";
import {
  branch,
  buildNumber,
  commitSha,
  defaultBranch,
} from "../lib/ci/ci-environment.ts";
import { requiredArgument } from "./read-ci-handoff.ts";

async function admit(): Promise<void> {
  const target = defaultBranch();
  if (branch() !== target) {
    throw new Error(`homelab release admission only supports ${target} builds`);
  }
  const admission = decideHomelabReleaseAdmission({
    buildCommit: commitSha(),
    currentMainCommit: await resolveOriginMainCommit(target),
    buildNumber: buildNumber(),
  });
  await writeJsonHandoff(HOMELAB_RELEASE_ADMISSION_KEY, admission);
  console.log(
    `homelab release ${admission.outcome}: build ${admission.buildCommit}, current main ${admission.currentMainCommit}`,
  );
}

async function consume(): Promise<void> {
  const raw = await readRequiredHandoff(HOMELAB_RELEASE_ADMISSION_KEY);
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
