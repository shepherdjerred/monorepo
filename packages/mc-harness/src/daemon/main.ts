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
import { Kubectl } from "#providers/kubernetes/kubectl.ts";
import { KubernetesSandboxProvider } from "#providers/kubernetes/provider.ts";
import { LIVE_TOKEN_ENV } from "#protocol/live.ts";
import { SandboxProviders } from "#sandbox/backend.ts";
import { SandboxStore } from "#sandbox/record.ts";
import { LiveService } from "#src/live/service.ts";
import { VELERO_NAMESPACE, liveKubeTarget } from "#src/live/status.ts";
import { liveGuardConfig, loadMcDaemonConfig } from "./config.ts";
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
  const context = await config.value("mcKubeContext");
  const live = new LiveService({
    kubectl: new Kubectl(liveKubeTarget(context)),
    velero: new Kubectl(liveKubeTarget(context, VELERO_NAMESPACE)),
    // Supplied once at daemon start (`op read`); never logged or returned.
    token: () => Bun.env[LIVE_TOKEN_ENV],
    config: () => liveGuardConfig(config),
    log: logLine,
  });
  await startDaemon({
    live,
    provider: new SandboxProviders(
      {
        docker: new DockerSandboxProvider({ repoRoot, store }),
        kubernetes: new KubernetesSandboxProvider({
          repoRoot,
          store,
          target: {
            context,
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
