/**
 * Entry point of the mc-harness daemon. `toolkit mc daemon start` runs it
 * detached with `bun run <repo>/packages/mc-harness/src/daemon/main.ts`; it
 * must run from source because sandboxes stage the repo-built MCBridge.jar.
 */
import path from "node:path";
import { DEFAULT_DAEMON_TTL_SECONDS } from "#protocol/paths.ts";
import { DockerSandboxProvider } from "#providers/docker/provider.ts";
import {
  MC_HARNESS_SERVICE_ACCOUNT,
  MC_SANDBOX_NAMESPACE,
} from "#providers/kubernetes/kubectl.ts";
import { KubernetesSandboxProvider } from "#providers/kubernetes/provider.ts";
import { SandboxProviders } from "#sandbox/backend.ts";
import { SandboxStore } from "#sandbox/record.ts";
import { loadMcDaemonConfig } from "./config.ts";
import { logLine, startDaemon } from "./serve.ts";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const ttlRaw = Bun.env["TOOLKIT_MC_TTL_SECONDS"];
const ttlSeconds =
  ttlRaw !== undefined && /^\d+$/u.test(ttlRaw)
    ? Number(ttlRaw)
    : DEFAULT_DAEMON_TTL_SECONDS;

try {
  const config = await loadMcDaemonConfig();
  const store = new SandboxStore();
  await startDaemon({
    provider: new SandboxProviders(
      {
        docker: new DockerSandboxProvider({ repoRoot, store }),
        kubernetes: new KubernetesSandboxProvider({
          repoRoot,
          store,
          target: {
            context: await config.value("mcKubeContext"),
            namespace: MC_SANDBOX_NAMESPACE,
            as: MC_HARNESS_SERVICE_ACCOUNT,
          },
          log: logLine,
        }),
      },
      store,
    ),
    ttlSeconds,
    repoRoot,
  });
} catch (error) {
  logLine("fatal startup error", {
    error: error instanceof Error ? error.message : String(error),
  });
  throw error;
}
