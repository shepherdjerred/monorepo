// OpenCode runs locally. The detached queries keep session creation non-blocking.
export const WorktreeReminder = async ({ client, directory, worktree }) => ({
  event: async ({ event }) => {
    if (event.type !== "session.created") return;

    const gitDir = Bun.spawn(["git", "rev-parse", "--absolute-git-dir"], {
      cwd: worktree,
      stdout: "pipe",
      stderr: "ignore",
    });
    const commonDir = Bun.spawn(
      ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
      { cwd: worktree, stdout: "pipe", stderr: "ignore" },
    );

    void Promise.all([
      new Response(gitDir.stdout).text(),
      new Response(commonDir.stdout).text(),
      gitDir.exited,
      commonDir.exited,
    ]).then(
      ([gitDirPath, commonDirPath, gitDirExitCode, commonDirExitCode]) => {
        if (
          gitDirExitCode !== 0 ||
          commonDirExitCode !== 0 ||
          gitDirPath.trim() !== commonDirPath.trim()
        ) {
          return;
        }

        void client.tui.showToast({
          body: {
            title: "Worktree reminder",
            message:
              "This session is in the main checkout. Create a worktree before a non-trivial edit.",
            variant: "warning",
            duration: 10_000,
          },
          query: { directory },
        });
      },
    );
  },
});
