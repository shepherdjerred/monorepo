/**
 * Path shards for the repo-wide root checks (prettier, line-endings,
 * large-files). Each check runs once per shard so a typical change re-runs
 * only the shard(s) it touched instead of paying the whole-tree check on
 * every commit (the old `//#prettier` alone was ~1 min of every verify).
 *
 * The same partition is encoded three ways, kept in lockstep:
 * - `matchShard` — the executable definition;
 * - `shardPathspecs` — git pathspec magic selecting the same set, consumed by
 *   the `git ls-files`-based checks;
 * - `shardTurboInputs` — the glob form mirrored into each shard task's
 *   `inputs` in the root turbo.json.
 * `repo-shards.test.ts` asserts all three agree on every tracked file, so a
 * new top-level directory cannot silently escape checking and shards cannot
 * overlap.
 */

export const SHARD_NAMES = ["scout", "homelab", "packages", "root"] as const;
export type ShardName = (typeof SHARD_NAMES)[number];

const SHARD_PATHSPECS: Record<ShardName, readonly string[]> = {
  scout: ["packages/scout-for-lol"],
  homelab: ["packages/homelab"],
  packages: [
    "packages",
    ":(exclude)packages/scout-for-lol",
    ":(exclude)packages/homelab",
  ],
  root: [".", ":(exclude)packages"],
};

const SHARD_TURBO_INPUTS: Record<ShardName, readonly string[]> = {
  scout: ["packages/scout-for-lol/**"],
  homelab: ["packages/homelab/**"],
  packages: [
    "packages/**",
    "!packages/scout-for-lol/**",
    "!packages/homelab/**",
  ],
  root: ["**/*", "!packages/**"],
};

export function shardPathspecs(shard: ShardName): readonly string[] {
  return SHARD_PATHSPECS[shard];
}

export function shardTurboInputs(shard: ShardName): readonly string[] {
  return SHARD_TURBO_INPUTS[shard];
}

export function matchShard(path: string): ShardName {
  if (path.startsWith("packages/scout-for-lol/")) return "scout";
  if (path.startsWith("packages/homelab/")) return "homelab";
  if (path.startsWith("packages/")) return "packages";
  return "root";
}

export function parseShardName(value: string): ShardName {
  const shard = SHARD_NAMES.find((name) => name === value);
  if (shard === undefined) {
    throw new Error(
      `unknown shard "${value}" (expected one of: ${SHARD_NAMES.join(", ")})`,
    );
  }
  return shard;
}
