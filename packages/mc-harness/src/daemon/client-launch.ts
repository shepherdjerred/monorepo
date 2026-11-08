import path from "node:path";
import { CLIENT_PROJECT } from "#protocol/paths.ts";

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
  kill: (signal: NodeJS.Signals) => void | Promise<void>;
};

export type ClientLauncher = (
  spec: LaunchSpec,
) => LaunchedClient | Promise<LaunchedClient>;

/** `mise exec -- gradle -p packages/the-storm/client runClient …` from the repo. */
export const gradleLauncher: ClientLauncher = (spec) => {
  const log = Bun.file(spec.logPath);
  const child = Bun.spawn(
    [
      "mise",
      "exec",
      "--",
      "gradle",
      "-p",
      path.join(spec.repoRoot, CLIENT_PROJECT),
      "runClient",
      `-PpreviewSession=${spec.bootstrapPath}`,
      `-PpreviewGameDir=${spec.gameDir}`,
      `-PpreviewUsername=${spec.username}`,
      "--console=plain",
      "--no-daemon",
    ],
    {
      cwd: spec.repoRoot,
      stdout: log,
      stderr: log,
      stdin: "ignore",
      env: {
        ...Bun.env,
        OP_SERVICE_ACCOUNT_TOKEN: undefined,
        MC_BRIDGE_TOKEN: undefined,
      },
    },
  );
  return {
    pid: child.pid,
    exited: child.exited,
    exitCode: () => child.exitCode,
    kill: (signal) => {
      child.kill(signal);
    },
  };
};
