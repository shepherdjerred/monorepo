import { $ } from "bun";
import { outcomeIcon, summaryLanes, summarySteps } from "./migration-core.ts";

if (import.meta.main) {
  const lines = [
    "### :rocket: main build summary",
    "",
    "| Step | Outcome |",
    "| --- | --- |",
  ];
  for (const step of summarySteps) {
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
