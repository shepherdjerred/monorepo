/**
 * Shared helpers for bundling multiple CI checks into a single Dagger function.
 *
 * Each bundle runs its children in parallel via `Promise.allSettled`, joins
 * their output with `--- :name` log markers (Buildkite-collapse-friendly), and
 * throws with the full structured output if any child rejected. The throw
 * preserves every child's stdout/stderr in the message so a single failing
 * child stays diagnosable in the BK log.
 *
 * The engine de-dups identical container graphs by content-address, so sibling
 * containers that share `bunBaseContainer` (or any other common prefix) collapse
 * to one install/source-fetch — three parallel containers, one materialisation.
 */
import { ExecError } from "@dagger.io/dagger";

function formatSection(
  name: string,
  result: PromiseSettledResult<string>,
): string {
  if (result.status === "fulfilled") {
    return `--- :white_check_mark: ${name}\n${result.value}`;
  }
  const reason = result.reason;
  if (reason instanceof ExecError) {
    return [
      `+++ :x: ${name} (exit ${reason.exitCode})`,
      `command: ${reason.cmd}`,
      reason.stdout,
      reason.stderr,
    ]
      .filter((s) => s !== "")
      .join("\n");
  }
  const msg = reason instanceof Error ? reason.message : String(reason);
  return `+++ :x: ${name}\n${msg}`;
}

/**
 * Join settled child results into one BK-collapse-friendly string. Throws if
 * any child rejected — the error message contains every child's output so the
 * failing child stays visible in the BK log.
 */
export function aggregateBundle(
  childNames: string[],
  results: PromiseSettledResult<string>[],
): string {
  if (childNames.length !== results.length) {
    throw new Error(
      `aggregateBundle: name/result length mismatch (${childNames.length.toString()} vs ${results.length.toString()})`,
    );
  }
  const sections = results.map((r, i) =>
    formatSection(childNames[i] ?? `child-${i.toString()}`, r),
  );
  const output = sections.join("\n\n");
  const failed = results.flatMap((r, i) =>
    r.status === "rejected" ? [childNames[i] ?? `child-${i.toString()}`] : [],
  );
  if (failed.length > 0) {
    throw new Error(
      `${output}\n\n+++ :no_entry: bundle failed: ${failed.join(", ")}`,
    );
  }
  return output;
}

/**
 * Run an array of named promise-producing thunks in parallel and aggregate.
 * The thunks are evaluated immediately to start the work; only the results
 * pass through `Promise.allSettled`.
 */
export async function runBundle<T extends string>(
  children: { name: T; run: () => Promise<string> }[],
): Promise<string> {
  const names = children.map((c) => c.name);
  const results = await Promise.allSettled(children.map((c) => c.run()));
  return aggregateBundle(names, results);
}
