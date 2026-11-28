import path from "node:path";
import { CLIENT_PROJECT } from "#protocol/paths.ts";
import { findSessionPids } from "./prism-process.ts";

/** What the mod reads from `-Dstorm.client.session` (Session.java). */
export type ClientBootstrap = {
  socket: string;
  artifacts: string;
  server: string;
  target?: "live" | "capture";
};

export type LaunchSpec = {
  repoRoot: string;
  bootstrapPath: string;
  bootstrap: ClientBootstrap;
  gameDir: string;
  username: string;
  logPath: string;
};

export type LaunchedClient = {
  pid: number;
  exited: Promise<number>;
  exitCode: () => number | null;
  failureReason?: () => string | undefined;
  kill: (signal: NodeJS.Signals) => void | Promise<void>;
};

export type ClientLauncher = (
  spec: LaunchSpec,
) => LaunchedClient | Promise<LaunchedClient>;

function signalIgnoreGone(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH"))
      throw error;
  }
}

export function gradleLaunchArgs(spec: LaunchSpec): string[] {
  const privateDir = path.dirname(spec.bootstrapPath);
  const gradleCacheDir = path.join(privateDir, "gradle-cache");
  return [
    "mise",
    "exec",
    "--",
    "gradle",
    "-p",
    path.join(spec.repoRoot, CLIENT_PROJECT),
    "--project-cache-dir",
    gradleCacheDir,
    "runClient",
    `-PpreviewSession=${spec.bootstrapPath}`,
    `-PpreviewGameDir=${spec.gameDir}`,
    `-PpreviewUsername=${spec.username}`,
    "--console=plain",
    "--no-daemon",
  ];
}

/** `mise exec -- gradle -p packages/the-storm/client runClient …` from the repo. */
export const gradleLauncher: ClientLauncher = (spec) => {
  const log = Bun.file(spec.logPath);
  const isPosix = process.platform !== "win32";
  const child = Bun.spawn(gradleLaunchArgs(spec), {
    cwd: spec.repoRoot,
    stdout: log,
    stderr: log,
    stdin: "ignore",
    detached: isPosix,
    env: {
      ...Bun.env,
      OP_SERVICE_ACCOUNT_TOKEN: undefined,
      MC_BRIDGE_TOKEN: undefined,
    },
  });
  const terminateLeftoverJvms = (signal: NodeJS.Signals): void => {
    for (const pid of findSessionPids(spec.bootstrapPath)) {
      signalIgnoreGone(pid, signal);
    }
  };
  return {
    pid: child.pid,
    exited: (async () => {
      try {
        return await child.exited;
      } finally {
        terminateLeftoverJvms("SIGKILL");
      }
    })(),
    exitCode: () => child.exitCode,
    kill: (signal) => {
      if (isPosix && child.pid > 1) {
        signalIgnoreGone(-child.pid, signal);
      }
      try {
        child.kill(signal);
      } catch {
        // Child may have already exited while forked JVMs remain.
      }
      terminateLeftoverJvms(signal);
    },
  };
};
