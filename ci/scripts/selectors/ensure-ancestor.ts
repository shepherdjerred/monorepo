type CommandResult = { readonly exitCode: number; readonly stdout: string };
type Executor = (command: readonly string[]) => Promise<CommandResult>;

/**
 * Woodpecker's default partial clone has depth one. A base resolved by the
 * configuration extension is unusable for a local diff until the checkout has
 * enough history to prove it is an ancestor. Fetch commit objects only; Git
 * loads the trees needed by the eventual diff on demand.
 */
export async function ensureAncestor(
  base: string,
  head: string,
  execute: Executor,
  fetchHistory: boolean,
): Promise<boolean> {
  const valid = async (): Promise<boolean> => {
    for (const command of [
      ["git", "cat-file", "-e", `${base}^{commit}`],
      ["git", "merge-base", "--is-ancestor", base, head],
    ]) {
      const result = await execute(command);
      if (result.exitCode !== 0) return false;
    }
    return true;
  };

  if (await valid()) return true;
  if (!fetchHistory) return false;
  const shallow = await execute([
    "git",
    "rev-parse",
    "--is-shallow-repository",
  ]);
  if (shallow.exitCode !== 0 || shallow.stdout.trim() !== "true") return false;
  const commit = await execute(["git", "rev-parse", "HEAD"]);
  if (commit.exitCode !== 0 || !/^[a-f\d]{40}$/.test(commit.stdout.trim())) {
    return false;
  }

  // Most green bases are nearby. Bound the fetch so a long-broken release
  // conservatively runs all lanes instead of downloading the full history.
  for (const depth of [32, 128, 512]) {
    const fetched = await execute([
      "git",
      "fetch",
      "--no-tags",
      "--filter=tree:0",
      `--deepen=${depth.toString()}`,
      "origin",
      commit.stdout.trim(),
    ]);
    if (fetched.exitCode !== 0) return false;
    if (await valid()) return true;
  }
  return false;
}
