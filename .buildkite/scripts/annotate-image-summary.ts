// Build-page justification for the images step: renders WHY each image target
// was built or skipped (and, on main, whether its content actually changed)
// as a Buildkite annotation. Reads the JSON side channels bake-images.sh
// produces; never touches the selector's stdout contract.
//
// Dependency-free on purpose: bake-images.sh runs before any workspace
// install, so this script (like select-image-targets.ts) can only use Bun
// built-ins — validation is manual narrowing, not Zod.
//
// Usage:
//   annotate-image-summary.ts (--report <file> | --fallback <message>)
//     [--outcomes <file>]
//
// Outside Buildkite (BUILDKITE != "true") the markdown goes to stdout so the
// script can be exercised locally.

import { ALL_IMAGE_TARGETS } from "./select-image-targets.ts";
import type { SelectionReport } from "./select-image-targets.ts";

type PushOutcome = {
  image: string;
  outcome: string;
};

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function parseReport(text: string): SelectionReport {
  const raw: unknown = JSON.parse(text);
  if (typeof raw !== "object" || raw === null) {
    throw new Error("selection report is not an object");
  }
  const record: Record<string, unknown> = { ...raw };
  const { base, changedPaths, mode, globalReason, targets } = record;
  if (base !== null && typeof base !== "string") {
    throw new Error("selection report base must be string|null");
  }
  if (!isStringArray(changedPaths)) {
    throw new Error("selection report changedPaths must be string[]");
  }
  if (mode !== "selected" && mode !== "all") {
    throw new Error("selection report mode must be selected|all");
  }
  if (globalReason !== null && typeof globalReason !== "string") {
    throw new Error("selection report globalReason must be string|null");
  }
  if (typeof targets !== "object" || targets === null) {
    throw new Error("selection report targets must be an object");
  }
  const targetReasons: Record<string, string[]> = {};
  for (const [target, reasons] of Object.entries(targets)) {
    if (!isStringArray(reasons)) {
      throw new Error(
        `selection report reasons for ${target} must be string[]`,
      );
    }
    targetReasons[target] = reasons;
  }
  return { base, changedPaths, mode, globalReason, targets: targetReasons };
}

function parseOutcomes(text: string): PushOutcome[] {
  const raw: unknown = JSON.parse(text);
  if (!Array.isArray(raw)) throw new Error("push outcomes must be an array");
  return raw.map((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error("push outcome entry must be an object");
    }
    const record: Record<string, unknown> = { ...entry };
    const { image, outcome } = record;
    if (typeof image !== "string" || typeof outcome !== "string") {
      throw new TypeError("push outcome entry needs string image and outcome");
    }
    return { image, outcome };
  });
}

function flagValue(flag: string): string | undefined {
  const index = Bun.argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = Bun.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

const OUTCOME_LABELS: Record<string, string> = {
  bumped: ":arrow_up: content changed — version bumped",
  "content-unchanged": ":white_check_mark: identical rootfs — no bump",
  "no-pin-bumped": ":new: no existing pin — bumped",
  "pin-unresolvable-bumped": ":warning: pin unresolvable — bumped",
};

function renderMarkdown(
  report: SelectionReport | null,
  fallback: string | undefined,
  outcomes: PushOutcome[] | null,
): string {
  const lines: string[] = [];
  if (report === null) {
    lines.push(
      "### :docker: image selection — fail-open (built ALL images)",
      "",
      `> ${fallback ?? "no selection report was produced"}`,
      "",
    );
  } else {
    const selectedCount = Object.keys(report.targets).length;
    const heading =
      report.mode === "all"
        ? "### :docker: image selection — ALL targets"
        : `### :docker: image selection — ${String(selectedCount)} of ${String(ALL_IMAGE_TARGETS.length)} targets`;
    lines.push(heading, "");
    if (report.base !== null) {
      lines.push(
        `Diffed against \`${report.base}\` — ${String(report.changedPaths.length)} changed file(s).`,
        "",
      );
    }
    if (report.mode === "all" && report.globalReason !== null) {
      lines.push(`> ${report.globalReason}`, "");
    }
    lines.push("| Target | Decision | Why |", "| --- | --- | --- |");
    for (const target of ALL_IMAGE_TARGETS) {
      const reasons = report.targets[target];
      if (reasons === undefined) {
        lines.push(
          `| \`${target}\` | :fast_forward: skip | no closure input changed |`,
        );
      } else {
        lines.push(
          `| \`${target}\` | :hammer: build | ${reasons.join("<br>")} |`,
        );
      }
    }
    lines.push("");
    if (report.changedPaths.length > 0) {
      lines.push(
        "<details>",
        `<summary>${String(report.changedPaths.length)} changed file(s)</summary>`,
        "",
        ...report.changedPaths.map((path) => `- \`${path}\``),
        "",
        "</details>",
        "",
      );
    }
  }

  if (outcomes !== null && outcomes.length > 0) {
    lines.push("**Push outcomes**", "", "| Image | Outcome |", "| --- | --- |");
    for (const { image, outcome } of outcomes) {
      lines.push(`| \`${image}\` | ${OUTCOME_LABELS[outcome] ?? outcome} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function main(): Promise<void> {
  const reportPath = flagValue("--report");
  const fallback = flagValue("--fallback");
  const outcomesPath = flagValue("--outcomes");

  if (reportPath === undefined && fallback === undefined) {
    console.error("one of --report or --fallback is required");
    process.exit(2);
  }

  const report =
    reportPath === undefined
      ? null
      : parseReport(await Bun.file(reportPath).text());

  const outcomes =
    outcomesPath === undefined
      ? null
      : parseOutcomes(await Bun.file(outcomesPath).text());

  const markdown = renderMarkdown(report, fallback, outcomes);

  if (Bun.env["BUILDKITE"] === "true") {
    const proc = Bun.spawnSync(
      ["buildkite-agent", "annotate", "--style", "info", "--context", "images"],
      {
        stdin: new TextEncoder().encode(markdown),
        stdout: "inherit",
        stderr: "inherit",
      },
    );
    if (proc.exitCode !== 0) {
      throw new Error(
        `buildkite-agent annotate exited ${String(proc.exitCode)}`,
      );
    }
  } else {
    console.log(markdown);
  }
}

if (import.meta.main) {
  await main();
}
