import {
  FixedCorpusConfigurationError,
  fixedCorpusForcesLane,
  selectorPathsForLane,
} from "../migration-core.ts";
import { requestedPlatformTofuApply } from "./tofu-lane-paths.ts";

/**
 * Lane decisions are no longer recorded anywhere.
 *
 * They existed only to feed the Buildkite build-summary annotation, which has
 * no successor. The decision is still printed, which is what a reader of a
 * step log actually needs.
 */

async function execute(
  command: readonly string[],
): Promise<{ readonly exitCode: number; readonly stdout: string }> {
  const process = Bun.spawn([...command], {
    stdout: "pipe",
    stderr: "inherit",
  });
  const stdout = await new Response(process.stdout).text();
  return { exitCode: await process.exited, stdout };
}

async function main(): Promise<number> {
  const lane = Bun.argv[2];
  if (lane === undefined || lane.length === 0) {
    console.error("Usage: ci-changed.ts <lane>");
    return 0;
  }
  const requestedPlatformApply = requestedPlatformTofuApply(Bun.env);
  if (lane === "tofu-platforms" && requestedPlatformApply !== undefined) {
    console.log(
      `${lane}: explicit ${requestedPlatformApply} apply requested; running`,
    );
    return 0;
  }
  if (fixedCorpusForcesLane(lane, Bun.env)) {
    console.log(`${lane}: fixed CI I/O corpus requested; running`);
    return 0;
  }
  // The configuration extension resolves the last green main commit and writes
  // it into every step's environment, so there is nothing to look up here. An
  // absent base means the extension could not resolve one, and the lane runs.
  const base = Bun.env["CI_CHANGED_BASE"];
  if (base === undefined || base.length === 0) {
    console.log(`${lane}: no CI_CHANGED_BASE; running`);
    return 0;
  }
  for (const command of [
    ["git", "cat-file", "-e", `${base}^{commit}`],
    ["git", "merge-base", "--is-ancestor", base, "HEAD"],
  ]) {
    const validation = await execute(command);
    if (validation.exitCode !== 0) {
      console.log(`${lane}: selector base ${base} invalid; running`);
      return 0;
    }
  }
  if (lane === "images") {
    const selection = await execute([
      "bun",
      "--no-install",
      "ci/scripts/selectors/select-image-targets.ts",
      "--base",
      base,
      "--reasons-out",
      "image-selection-report.json",
    ]);
    if (selection.exitCode !== 0) throw new Error("image selector failed");
    const targets = selection.stdout.trim();
    if (targets === "[]") {
      console.log(`${lane}: unchanged since ${base}; skipping`);
      return 78;
    }
    console.log(`${lane}: selected targets ${targets}`);
    return 0;
  }
  const paths = selectorPathsForLane(lane);
  if (paths === undefined) {
    console.error(`WARN: unknown CI selector lane ${lane}; running it`);
    return 0;
  }
  const changed = await execute([
    "git",
    "diff",
    "--name-only",
    base,
    "HEAD",
    "--",
    ...paths,
  ]);
  if (changed.exitCode !== 0)
    throw new Error(`git diff exited ${changed.exitCode.toString()}`);
  const changedFiles = changed.stdout.trim().split("\n").filter(Boolean);
  if (changedFiles.length === 0) {
    console.log(`${lane}: unchanged since ${base}; skipping`);
    return 78;
  }
  console.log(
    `${lane}: ${changedFiles.length.toString()} matching change(s) since ${base}: ${changedFiles.slice(0, 3).join(" ")}; running`,
  );
  return 0;
}

if (import.meta.main) {
  const lane = Bun.argv[2] ?? "unknown";
  try {
    process.exitCode = await main();
  } catch (error) {
    if (error instanceof FixedCorpusConfigurationError) {
      throw error;
    }
    console.error(
      "WARN: CI change selector failed for %s; running lane",
      lane,
      error,
    );
    process.exitCode = 0;
  }
}
