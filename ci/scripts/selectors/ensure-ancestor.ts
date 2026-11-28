type CommandResult = { readonly exitCode: number; readonly stdout: string };
type Executor = (command: readonly string[]) => Promise<CommandResult>;

/**
 * Woodpecker's default partial clone has depth one. A base resolved by the
 * configuration extension is unusable for a local diff until the checkout has
 * enough history to prove it is an ancestor. Deepen the checkout, without a
 * partial-clone filter (see the fetch below), so the eventual diff finds the
 * base's trees locally.
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
  //
  // No `--filter`: a filtered fetch turns the workspace into a partial clone,
  // and Git then rewrites every local object into a new promisor pack. In a
  // golden clone that is the whole checkout (about 1 GB, and the size of the
  // golden's entire history once it holds any) written again on every run. An
  // unfiltered deepen negotiates against the golden's objects, so only commits
  // newer than the golden cost anything (28 MB against 1 GB when replayed).
  for (const depth of [32, 128, 512]) {
    const fetched = await execute([
      "git",
      "fetch",
      "--no-tags",
      `--deepen=${depth.toString()}`,
      "origin",
      commit.stdout.trim(),
    ]);
    if (fetched.exitCode !== 0) return false;
    if (await valid()) return true;
  }
  return false;
}
