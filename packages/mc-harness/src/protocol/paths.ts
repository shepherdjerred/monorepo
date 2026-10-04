import os from "node:os";
import path from "node:path";

// Filesystem layout for the session daemon. Everything is private to the user:
// the socket is chmod 0600 and sandbox records (which hold the bridge token)
// are written 0600.
export const MC_DIR = path.join(os.homedir(), ".toolkit", "mc");
export const SOCKET_PATH = path.join(MC_DIR, "daemon.sock");
export const STATE_PATH = path.join(MC_DIR, "state.json");
export const LOGS_DIR = path.join(MC_DIR, "logs");
export const SANDBOXES_DIR = path.join(MC_DIR, "sandboxes");
export const CACHE_DIR = path.join(MC_DIR, "cache");

/** Path of the daemon entry point relative to the repository root. */
export const DAEMON_ENTRY = path.join(
  "packages",
  "mc-harness",
  "src",
  "daemon",
  "main.ts",
);

/** Path of the built MCBridge plugin relative to the repository root. */
export const BRIDGE_JAR = path.join(
  "packages",
  "the-storm",
  "plugin",
  "bridge",
  "build",
  "libs",
  "MCBridge.jar",
);
export const BRIDGE_BUILD_COMMAND =
  "mise exec -- gradle -p packages/the-storm/plugin :bridge:assemble";

export const DEFAULT_DAEMON_TTL_SECONDS = 4 * 60 * 60;
export const DEFAULT_SANDBOX_TTL_SECONDS = 2 * 60 * 60;
