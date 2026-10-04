/**
 * Entry point of the mc-harness daemon. `toolkit mc daemon start` runs it
 * detached with `bun run <repo>/packages/mc-harness/src/daemon/main.ts`; it
 * must run from source because sandboxes stage the repo-built MCBridge.jar.
 */
import path from "node:path";
import { DEFAULT_DAEMON_TTL_SECONDS } from "#protocol/paths.ts";
import { DockerSandboxProvider } from "#providers/docker/provider.ts";
import { SandboxStore } from "#sandbox/record.ts";
import { logLine, startDaemon } from "./serve.ts";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const ttlRaw = Bun.env["TOOLKIT_MC_TTL_SECONDS"];
const ttlSeconds =
  ttlRaw !== undefined && /^\d+$/u.test(ttlRaw)
    ? Number(ttlRaw)
    : DEFAULT_DAEMON_TTL_SECONDS;

try {
  await startDaemon({
    provider: new DockerSandboxProvider({
      repoRoot,
      store: new SandboxStore(),
    }),
    ttlSeconds,
    repoRoot,
  });
} catch (error) {
  logLine("fatal startup error", {
    error: error instanceof Error ? error.message : String(error),
  });
  throw error;
}
