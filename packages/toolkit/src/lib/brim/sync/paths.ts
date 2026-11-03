import os from "node:os";
import path from "node:path";

/** Local files owned by `brim sync`, all under `~/.toolkit/brim-sync/`. */
export type BrimSyncPaths = {
  readonly home: string;
  readonly root: string;
  /** Plaintext copy of this machine's committed manifest; the push state. */
  readonly manifest: string;
  readonly lock: string;
  readonly pullState: string;
  readonly mirrorDir: string;
  readonly mirrorIndex: string;
  readonly logsDir: string;
  readonly launchAgent: string;
};

export function defaultBrimSyncPaths(home = os.homedir()): BrimSyncPaths {
  const root = path.join(home, ".toolkit", "brim-sync");
  const mirrorDir = path.join(root, "mirror");
  return {
    home,
    root,
    manifest: path.join(root, "manifest.json"),
    lock: path.join(root, "sync.lock"),
    pullState: path.join(root, "pull-state.json"),
    mirrorDir,
    mirrorIndex: path.join(mirrorDir, "index.json"),
    logsDir: path.join(root, "logs"),
    launchAgent: path.join(
      home,
      "Library",
      "LaunchAgents",
      "com.jerred.brim-sync.plist",
    ),
  };
}

/** The mirror directory that holds one remote machine's files. */
export function mirrorMachineDir(
  paths: BrimSyncPaths,
  machineId: string,
): string {
  return path.join(paths.mirrorDir, machineId);
}

/**
 * Archive paths always use `/`, whatever the source platform, so a Windows
 * archive can be pulled onto a Mac.
 */
export function toArchivePath(relative: string): string {
  return relative.split(path.sep).join("/");
}

/** Resolves an archive path under `root`, refusing anything that escapes it. */
export function fromArchivePath(root: string, archivePath: string): string {
  const segments = archivePath.split("/");
  if (
    archivePath.length === 0 ||
    archivePath.startsWith("/") ||
    segments.some(
      (segment) => segment === ".." || segment === "." || segment === "",
    ) ||
    /[\\:]/.test(archivePath)
  ) {
    throw new Error(`Refusing unsafe archive path: ${archivePath}`);
  }
  return path.join(root, ...segments);
}
