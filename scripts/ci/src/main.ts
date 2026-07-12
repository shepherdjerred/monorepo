/**
 * CI pipeline generator entry point.
 *
 * Detects changed packages, builds a Buildkite pipeline, and outputs JSON to stdout.
 * All diagnostic output goes to stderr so only the pipeline JSON goes to stdout.
 */
import { detectChanges } from "./change-detection/index.ts";
import { shouldSkipReleasePleasePrBuild } from "./change-detection/version-commit.ts";
import {
  buildPipeline,
  buildReleasePleaseSkipPipeline,
} from "./pipeline-builder.ts";
import { applyBuildAgePriority } from "./lib/build-age-priority.ts";
import { validateCatalog } from "./lib/validate-catalog.ts";

if (shouldSkipReleasePleasePrBuild()) {
  // Auto-triggered build of the release-please release PR: skip full CI. A real
  // run can be requested by triggering a build manually or setting
  // RUN_RELEASE_CI=true. See shouldSkipReleasePleasePrBuild for the rationale.
  console.error(
    "Release-please PR webhook build detected — auto-skipping full CI. " +
      "Trigger a build manually (Buildkite UI → New Build) or set " +
      "RUN_RELEASE_CI=true to run it.",
  );
  console.log(
    JSON.stringify(
      applyBuildAgePriority(buildReleasePleaseSkipPipeline()),
      null,
      2,
    ),
  );
} else {
  await validateCatalog();
  const affected = await detectChanges();
  const pipeline = applyBuildAgePriority(buildPipeline(affected));
  console.log(JSON.stringify(pipeline, null, 2));
}
