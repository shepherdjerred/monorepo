/** What the mod reads from `-Dstorm.client.session` (Session.java). */
export type ClientBootstrap = {
  socket: string;
  artifacts: string;
  server: string;
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
