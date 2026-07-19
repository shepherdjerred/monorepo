#!/usr/bin/env bun
/**
 * Print "affected" or "unaffected" for a turbo package on the current branch.
 *
 * Used by CI steps that gate heavy PR work (playwright e2e, texlive resume
 * build) on whether their package is in `turbo ls --affected`. The verdict is
 * printed to stdout; ANY tool failure (turbo missing, JSON shape change)
 * throws and exits non-zero so a broken gate fails the step loudly instead of
 * silently skipping it.
 *
 * Usage: bun scripts/is-affected.ts <package-name>
 */

import { z } from "zod";

const TurboLsSchema = z.object({
  packages: z.object({
    items: z.array(z.object({ name: z.string() })),
  }),
});

const pkg = Bun.argv[2];
if (pkg === undefined || pkg === "") {
  console.error("Usage: bun scripts/is-affected.ts <package-name>");
  process.exit(2);
}

// Spawned directly (not via lib/run.ts): stdout must carry ONLY the verdict —
// callers do `verdict=$(bun scripts/is-affected.ts <pkg>)` — and the lib
// echoes captured output. turbo's own diagnostics still stream on stderr.
const proc = Bun.spawn(["bunx", "turbo", "ls", "--affected", "--output=json"], {
  stdout: "pipe",
  stderr: "inherit",
});
const stdout = await new Response(proc.stdout).text();
const exitCode = await proc.exited;
if (exitCode !== 0) {
  throw new Error(`turbo ls --affected failed (exit ${exitCode.toString()})`);
}
const parsed = TurboLsSchema.parse(JSON.parse(stdout));
const affected = parsed.packages.items.some((item) => item.name === pkg);

if (!affected) {
  // Guard against a typo'd/renamed package silently reading as "unaffected"
  // forever: the package must at least exist in the full workspace listing.
  const allProc = Bun.spawn(["bunx", "turbo", "ls", "--output=json"], {
    stdout: "pipe",
    stderr: "inherit",
  });
  const allStdout = await new Response(allProc.stdout).text();
  const allExit = await allProc.exited;
  if (allExit !== 0) {
    throw new Error(`turbo ls failed (exit ${allExit.toString()})`);
  }
  const all = TurboLsSchema.parse(JSON.parse(allStdout));
  if (!all.packages.items.some((item) => item.name === pkg)) {
    throw new Error(`package ${pkg} does not exist in the workspace`);
  }
}

console.log(affected ? "affected" : "unaffected");
