import { realpath } from "node:fs/promises";
import nodePath from "node:path";
import type { GitCommandRunner } from "#activities/scout/scout-season-refresh-git.ts";

// The agent's edits and dependency code can execute in build and test steps.
// Expose only the worker image's toolchain and this attempt's scratch tree.
const TOOLCHAIN_MOUNTS = [
  "/bin",
  "/sbin",
  "/lib",
  "/lib64",
  "/usr",
  "/opt",
  "/etc/ssl",
  "/etc/fonts",
  "/etc/resolv.conf",
  "/etc/hosts",
  "/etc/nsswitch.conf",
  "/etc/passwd",
  "/etc/group",
] as const;

export async function cleanIgnoredAgentArtifacts(input: {
  repoDir: string;
  tempDir: string;
  commandRunner: GitCommandRunner;
}): Promise<void> {
  const scratchRoot = await realpath(input.tempDir);
  const cloneRoot = await realpath(input.repoDir);
  if (nodePath.relative(scratchRoot, cloneRoot) !== "monorepo") {
    throw new Error("Verification expected the disposable monorepo checkout.");
  }
  // Dependencies, cache entries and other ignored agent-side files must be
  // reproduced by the verifier. Keep tracked files and the verified patch.
  await input.commandRunner(["git", "clean", "-ffdX", "--"], {
    cwd: cloneRoot,
  });
}

export function sandboxBundleVerification(input: {
  tempDir: string;
  repoDir: string;
  commandRunner: GitCommandRunner;
}): GitCommandRunner {
  return (args, options) => {
    const tool = args[0];
    const subcommand = args[1];
    // Only registry fetch and locked installation need the external network.
    const network =
      (tool === "bun" && subcommand === "install") ||
      (tool === "cargo" && subcommand === "fetch") ||
      (tool === "go" && subcommand === "mod") ||
      (tool === "uv" && subcommand === "sync") ||
      (tool === "dotnet" && subcommand === "restore");
    return input.commandRunner(
      [
        "bwrap",
        "--unshare-all",
        ...(network ? ["--share-net"] : []),
        "--die-with-parent",
        "--new-session",
        "--cap-drop",
        "ALL",
        ...TOOLCHAIN_MOUNTS.flatMap((path) => ["--ro-bind-try", path, path]),
        "--proc",
        "/proc",
        "--dev",
        "/dev",
        "--tmpfs",
        "/tmp",
        "--bind",
        input.tempDir,
        input.tempDir,
        "--ro-bind",
        `${input.repoDir}/.git`,
        `${input.repoDir}/.git`,
        "--chdir",
        options.cwd,
        "--",
        ...args,
      ],
      {
        ...options,
        env: {
          ...options.env,
          HOME: input.tempDir,
          XDG_CACHE_HOME: `${input.tempDir}/.cache`,
          CARGO_HOME: `${input.tempDir}/.cargo`,
          GOPATH: `${input.tempDir}/go`,
          GOMODCACHE: `${input.tempDir}/go/pkg/mod`,
          TMPDIR: "/tmp",
          UV_CACHE_DIR: `${input.tempDir}/uv-cache`,
          DOTNET_CLI_HOME: input.tempDir,
        },
      },
    );
  };
}
