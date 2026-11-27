/**
 * One-time generator for `src/legacy-flag-dates.json`: the added time of every
 * key declared before the Flags server recorded `create` audit rows.
 *
 * For each key in the managed inventory it finds the first first-parent commit
 * on `main` whose `managed-flag-inventory.json` declares the key and records
 * that commit's committer date. Keys already present in the file's first commit
 * are marked `onOrBefore`, because they were declared earlier elsewhere.
 *
 * The output is frozen evidence, not a build artifact: CI never regenerates it,
 * and a key added after the audit trail started gets its `create` row instead.
 *
 *   bun packages/flags/scripts/generate-legacy-flag-dates.ts [<main ref>]
 */
import { z } from "zod";

const INVENTORY_PATH = "packages/feature-flags/src/managed-flag-inventory.json";
const OUTPUT_PATH = "packages/flags/src/legacy-flag-dates.json";

const InventoryKeysSchema = z.object({
  flags: z.array(z.object({ key: z.string().min(1) })),
});

function git(root: string, args: readonly string[]): string {
  const result = Bun.spawnSync(["git", "-C", root, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${result.stderr.toString().trim()}`,
    );
  }
  return result.stdout.toString();
}

const ref = Bun.argv[2] ?? "origin/main";
const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
const commits = git(root, [
  "log",
  "--first-parent",
  "--reverse",
  "--format=%H %cI",
  ref,
  "--",
  INVENTORY_PATH,
])
  .trim()
  .split("\n")
  .map((line) => {
    const [sha, date] = line.split(" ");
    if (sha === undefined || date === undefined) {
      throw new Error(`unexpected git log line: ${line}`);
    }
    return { sha, date: new Date(date).toISOString() };
  });

const current = InventoryKeysSchema.parse(
  JSON.parse(git(root, ["show", `${ref}:${INVENTORY_PATH}`])),
);
const firstSeen = new Map<string, { date: string; onOrBefore: boolean }>();
for (const [index, commit] of commits.entries()) {
  const version = InventoryKeysSchema.parse(
    JSON.parse(git(root, ["show", `${commit.sha}:${INVENTORY_PATH}`])),
  );
  for (const flag of version.flags) {
    if (!firstSeen.has(flag.key)) {
      firstSeen.set(flag.key, { date: commit.date, onOrBefore: index === 0 });
    }
  }
}

const dates: Record<string, { date: string; onOrBefore: boolean }> = {};
for (const key of current.flags.map((flag) => flag.key).toSorted()) {
  const seen = firstSeen.get(key);
  if (seen === undefined) throw new Error(`${key} has no inventory history`);
  dates[key] = seen;
}

const output = {
  $comment:
    "Frozen, generated once by packages/flags/scripts/generate-legacy-flag-dates.ts: the first-parent committer date of the first main commit whose managed-flag-inventory.json declares each key. onOrBefore marks keys present in that file's first commit (declared earlier elsewhere). Do not regenerate in CI; keys created after the audit trail started use their recorded create row.",
  computedAt: new Date().toISOString(),
  dates,
};
await Bun.write(
  `${root}/${OUTPUT_PATH}`,
  `${JSON.stringify(output, null, 2)}\n`,
);
console.warn(
  `wrote ${String(Object.keys(dates).length)} keys from ${String(commits.length)} commits to ${OUTPUT_PATH}`,
);
