export const WorktreeReminder = async ({ worktree }) => {
  const gitDir = Bun.spawn(["git", "rev-parse", "--absolute-git-dir"], {
    cwd: worktree,
    stdout: "pipe",
    stderr: "ignore",
  });
  const commonDir = Bun.spawn(
    ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd: worktree, stdout: "pipe", stderr: "ignore" },
  );
  const [gitDirPath, commonDirPath, gitDirExitCode, commonDirExitCode] =
    await Promise.all([
      new Response(gitDir.stdout).text(),
      new Response(commonDir.stdout).text(),
      gitDir.exited,
      commonDir.exited,
    ]);
  const isMainCheckout =
    gitDirExitCode === 0 &&
    commonDirExitCode === 0 &&
    gitDirPath.trim() === commonDirPath.trim();

  return {
    "experimental.chat.system.transform": async (_input, output) => {
      if (!isMainCheckout) return;

      output.system.push(
        "Worktree reminder: This session is in the main checkout. Create a worktree before a non-trivial edit. New work uses `gh stack`: load `gh-stack` and run `gh stack init --base main <branch>` inside the worktree. If the work is already managed by git-spice, load `git-spice-helper` and keep that stack on git-spice; never mix the tools.",
      );
    },
  };
};
