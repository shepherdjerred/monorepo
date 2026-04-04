/**
 * Version commit-back step generator.
 *
 * Collects per-image digests from Buildkite metadata (set by image push steps)
 * and commits updated version references back to the repo.
 */
import { IMAGE_PUSH_TARGETS, INFRA_PUSH_TARGETS } from "../catalog.ts";
import { daggerStep, DRYRUN_FLAG } from "../lib/buildkite.ts";
import type { BuildkiteStep } from "../lib/types.ts";

const MAIN_ONLY = "build.branch == pipeline.default_branch";

/** All image version keys that have digests set by push steps. */
const ALL_IMAGE_KEYS = [
  ...IMAGE_PUSH_TARGETS.map((t) => t.versionKey),
  ...INFRA_PUSH_TARGETS.map((t) => t.versionKey),
];

/**
 * Build a shell snippet that collects per-image digests into a JSON object.
 * Each image push step sets metadata at `digest:{versionKey}`.
 * Uses $$ to escape variables that must survive Buildkite expansion.
 */
function collectDigestsSnippet(): string {
  const lines = [`DIGESTS='{'`];
  for (const key of ALL_IMAGE_KEYS) {
    lines.push(
      `D=$$(buildkite-agent meta-data get "digest:${key}" --default "")`,
      `if [ -n "$$D" ]; then DIGESTS="$$DIGESTS\\"${key}\\":\\"$$D\\","; fi`,
    );
  }
  lines.push(`DIGESTS="$${`{DIGESTS%,}`}}"`, `echo "Digests: $$DIGESTS"`);
  return lines.join(" && ");
}

export function versionCommitBackStep(dependsOn: string[]): BuildkiteStep {
  return daggerStep({
    label: ":bookmark: Version Commit-Back",
    key: "version-commit-back",
    daggerCmd: `${collectDigestsSnippet()} && dagger call version-commit-back --digests "$$DIGESTS" --version "$BUILDKITE_BUILD_NUMBER" --gh-token env:GH_TOKEN${DRYRUN_FLAG}`,
    timeoutMinutes: 10,
    condition: MAIN_ONLY,
    dependsOn,
    priority: 1,
  });
}
