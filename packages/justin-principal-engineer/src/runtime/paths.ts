import os from "node:os";
import path from "node:path";

export type RuntimePaths = Readonly<{
  root: string;
  config: string;
  tasks: string;
  state: string;
  lock: string;
  logs: string;
  launchAgent: string;
}>;

export function runtimePaths(home = os.homedir()): RuntimePaths {
  const root = path.join(
    home,
    "Library",
    "Application Support",
    "justin-principal-engineer",
  );
  return {
    root,
    config: path.join(root, "config.json"),
    tasks: path.join(root, "tasks"),
    state: path.join(root, "state"),
    lock: path.join(root, "reconcile.lock"),
    logs: path.join(root, "logs"),
    launchAgent: path.join(
      home,
      "Library",
      "LaunchAgents",
      "com.sjerred.justin-principal-engineer.plist",
    ),
  };
}

export function issueStatePath(
  paths: RuntimePaths,
  identifier: string,
): string {
  return path.join(paths.state, `${identifier.toLowerCase()}.json`);
}
