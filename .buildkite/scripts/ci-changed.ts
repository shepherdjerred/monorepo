import {
  FixedCorpusConfigurationError,
  fixedCorpusForcesLane,
  globalPaths,
  lanePaths,
} from "./migration-core.ts";

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

async function recordDecision(lane: string, decision: string): Promise<void> {
  if (Bun.env["BUILDKITE"] !== "true") return;
  const result = await execute([
    "buildkite-agent",
    "meta-data",
    "set",
    `ci-lane-decision-${lane}`,
    decision,
  ]);
  if (result.exitCode !== 0) {
    console.error(`WARN: could not record lane decision for ${lane}`);
  }
}

async function main(): Promise<number> {
  const lane = Bun.argv[2];
  if (lane === undefined || lane.length === 0) {
    console.error("Usage: ci-changed.ts <lane>");
    return 0;
  }
  if (fixedCorpusForcesLane(lane, Bun.env)) {
    await recordDecision(lane, "ran — fixed CI I/O corpus requested");
    console.log(`${lane}: fixed CI I/O corpus requested; running`);
    return 0;
  }
  let base = Bun.env["CI_CHANGED_BASE"];
  if (base === undefined || base.length === 0) {
    const metadata = await execute([
      "buildkite-agent",
      "meta-data",
      "get",
      "ci-changed-base",
    ]);
    if (metadata.exitCode !== 0 || metadata.stdout.trim().length === 0) {
      await recordDecision(
        lane,
        "ran — ci-changed-base unavailable (fail-open)",
      );
      return 0;
    }
    base = metadata.stdout.trim();
  }
  for (const command of [
    ["git", "cat-file", "-e", `${base}^{commit}`],
    ["git", "merge-base", "--is-ancestor", base, "HEAD"],
  ]) {
    const validation = await execute(command);
    if (validation.exitCode !== 0) {
      await recordDecision(
        lane,
        `ran — selector base ${base} invalid (fail-open)`,
      );
      return 0;
    }
  }
  if (lane === "images") {
    const selection = await execute([
      "bun",
      "--no-install",
      ".buildkite/scripts/select-image-targets.ts",
      "--base",
      base,
      "--reasons-out",
      "image-selection-report.json",
    ]);
    if (selection.exitCode !== 0) throw new Error("image selector failed");
    const targets = selection.stdout.trim();
    if (targets === "[]") {
      await recordDecision(
        lane,
        `skipped — no image closure affected since ${base}`,
      );
      console.log(`${lane}: unchanged since ${base}; skipping`);
      return 78;
    }
    await recordDecision(lane, `ran — selected targets ${targets}`);
    console.log(`${lane}: selected targets ${targets}`);
    return 0;
  }
  const paths = lanePaths[lane];
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
    ...globalPaths,
    ...paths,
  ]);
  if (changed.exitCode !== 0)
    throw new Error(`git diff exited ${changed.exitCode.toString()}`);
  const changedFiles = changed.stdout.trim().split("\n").filter(Boolean);
  if (changedFiles.length === 0) {
    await recordDecision(lane, `skipped — unchanged since ${base}`);
    console.log(`${lane}: unchanged since ${base}; skipping`);
    return 78;
  }
  await recordDecision(
    lane,
    `ran — ${changedFiles.length.toString()} matching change(s) since ${base}: ${changedFiles.slice(0, 3).join(" ")}`,
  );
  console.log(`${lane}: changed since ${base}; running`);
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
    await recordDecision(lane, "ran — selector failed (fail-open)");
    process.exitCode = 0;
  }
}
