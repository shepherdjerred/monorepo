/**
 * Root knip gate: fail on unused-code issues AND on configuration hints.
 *
 * The previous root script ran `knip --no-config-hints`, which silently
 * suppressed knip's own configuration hygiene report (unused
 * `ignoreDependencies`/`ignoreBinaries` entries, phantom entry patterns,
 * stale ignores, missing package entry files, …). Those hints rotted to
 * 120+ suppressed findings. Knip 6.x has a structured, exit-code-affecting
 * option for exactly this — `--treat-config-hints-as-errors` — so this
 * wrapper needs no output parsing: knip prints the hints table itself and
 * exits non-zero when any hint (or issue) exists.
 *
 * One prestep runs first: temporal's ha-schema stub copy. Without it the
 * gate is bistable — `#generated/ha-schema.ts` is unresolved on a cold
 * tree, but a tree where some earlier task materialized it makes an
 * `ignoreUnresolved` entry for it stale, and knip reports whichever it
 * sees. Temporal deliberately has no `generate` turbo task (its real
 * codegen needs live HA credentials), so nothing else in the verify graph
 * guarantees the file exists before this gate runs. `ensure-ha-schema` is
 * the same idempotent stub copy temporal's own typecheck/test scripts use.
 *
 * Deliberately NOT a nested `turbo run generate`: `//#knip` runs inside the
 * verify graph, which already runs every package's `generate`, and a nested
 * invocation races those for the per-package Prisma generate lock (an
 * EEXIST crash). Turbo-generated artifacts are the outer graph's job.
 */
import { run } from "../lib/run.ts";

/** Commands that materialize generated files knip must be able to resolve. */
export const generateCommands = [
  ["bun", "packages/temporal/scripts/ensure-ha-schema.ts"],
];

/**
 * The exact argv the gate runs. Exported so the test can assert the
 * hint-enforcing flag is present and the old suppressing flag is not.
 */
export const knipCommand = [
  "bunx",
  "--no-install",
  "knip",
  "--treat-config-hints-as-errors",
];

export async function checkKnip(extraArgs: string[] = []): Promise<void> {
  await run([...knipCommand, ...extraArgs]);
}

if (import.meta.main) {
  for (const command of generateCommands) {
    await run([...command]);
  }
  await checkKnip(process.argv.slice(2));
}
