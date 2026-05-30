/**
 * Release-please step (main only).
 *
 * Runs release-please via Dagger to create/update version bump PRs
 * and GitHub releases, then runs a Claude agent to refine the
 * auto-generated CHANGELOGs to a library-consumer view (see
 * `.dagger/prompts/refine-release-please.md` for the agent prompt).
 *
 * Nothing depends on this step — version metadata is extracted
 * separately by extractVersionsStep (in quality.ts).
 *
 * Timeout is 20 min (was 10) to absorb the claude refine subprocess
 * on top of the two release-please CLI invocations.
 */
import {
  daggerStep,
  DRYRUN_FLAG,
  GITHUB_APP_SECRET_ARGS,
  CLAUDE_OAUTH_SECRET_ARG,
} from "../lib/buildkite.ts";
import type { BuildkiteStep } from "../lib/types.ts";

const MAIN_ONLY = "build.branch == pipeline.default_branch";

export function releasePleaseStep(dependsOn?: string[]): BuildkiteStep {
  const opts: Parameters<typeof daggerStep>[0] = {
    label: ":bookmark: Release Please",
    key: "release-please",
    daggerCmd: `dagger call release-please --source . ${GITHUB_APP_SECRET_ARGS} ${CLAUDE_OAUTH_SECRET_ARG}${DRYRUN_FLAG}`,
    timeoutMinutes: 20,
    condition: MAIN_ONLY,
    priority: 1,
  };
  if (dependsOn !== undefined) {
    opts.dependsOn = dependsOn;
  }
  return daggerStep(opts);
}
