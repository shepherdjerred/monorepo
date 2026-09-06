import { $ } from "bun";
import {
  outcomeIcon,
  summaryLanes,
  summarySteps,
} from "../images/build-summary-tables.ts";

/**
 * Steps the main selector uploaded. `buildkite-agent step get` exits nonzero
 * for a step that is not in the build, so querying an omitted step would fail
 * this job on an otherwise green build. An empty value means the complete
 * graph was uploaded (the selector's fallback path), so every step exists.
 */
async function uploadedSteps(): Promise<ReadonlySet<string> | null> {
  const raw =
    await $`buildkite-agent meta-data get ci-selected-main-steps --default ${""}`.text();
  const keys = raw
    .split("\n")
    .map((key) => key.trim())
    .filter((key) => key.length > 0);
  return keys.length === 0 ? null : new Set(keys);
}

if (import.meta.main) {
  const uploaded = await uploadedSteps();
  const lines = [
    "### :rocket: main build summary",
    "",
    "| Step | Outcome |",
    "| --- | --- |",
  ];
  for (const step of summarySteps) {
    if (uploaded !== null && !uploaded.has(step)) {
      lines.push(`| ${step} | :heavy_minus_sign: not selected |`);
      continue;
    }
    const rawOutcome =
      await $`buildkite-agent step get outcome --step ${step}`.text();
    const outcome = rawOutcome.trim();
    lines.push(`| ${step} | ${outcomeIcon(outcome)} ${outcome} |`);
  }
  lines.push(
    "",
    "**Lane decisions**",
    "",
    "| Lane | Decision |",
    "| --- | --- |",
  );
  for (const lane of summaryLanes) {
    const defaultValue =
      lane === "helm-types"
        ? "n/a — PR-only gate (pr-dryrun), not run on main"
        : "— (not recorded)";
    const rawDecision =
      await $`buildkite-agent meta-data get ${`ci-lane-decision-${lane}`} --default ${defaultValue}`.text();
    const decision = rawDecision.trim();
    lines.push(`| ${lane} | ${decision} |`);
  }
  const annotation = `${lines.join("\n")}\n`;
  const process = Bun.spawn(
    [
      "buildkite-agent",
      "annotate",
      "--style",
      "info",
      "--context",
      "build-summary",
    ],
    { stdin: new Blob([annotation]), stdout: "inherit", stderr: "inherit" },
  );
  const exitCode = await process.exited;
  if (exitCode !== 0)
    throw new Error(`annotation exited ${exitCode.toString()}`);
}
