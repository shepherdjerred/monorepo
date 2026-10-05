// Shared fakes for live-target tests: recorded cluster fixtures, a port-forward
// that binds at once, and a daemon context whose only target is `live`.
import path from "node:path";
import type { BridgeClient } from "#bridge/client.ts";
import { DaemonError } from "#daemon/http.ts";
import type { DaemonContext } from "#daemon/router.ts";
import { Kubectl, type KubectlRunner } from "#providers/kubernetes/kubectl.ts";
import type { ProcessSpawner } from "#providers/kubernetes/port-forward.ts";
import type { SandboxProvider } from "#sandbox/provider.ts";
import type { LiveGuardConfig } from "#src/live/guard.ts";
import type { LiveJournal } from "#src/live/journal.ts";
import { ClientManager } from "#daemon/clients.ts";
import { LiveService } from "#src/live/service.ts";
import { liveKubeTarget, StatefulSetSchema } from "#src/live/status.ts";

const fixtures = path.join(import.meta.dirname, "fixtures", "live");

export async function liveFixture(name: string): Promise<unknown> {
  const parsed: unknown = await Bun.file(path.join(fixtures, name)).json();
  return parsed;
}

export async function statefulSetFixture() {
  return StatefulSetSchema.parse(await liveFixture("statefulset.json"));
}

export const liveConfig: LiveGuardConfig = {
  writes: true,
  worlds: ["world", "wilds", "peaks"],
  maxRegionVolume: 1000,
  backupMaxAgeHours: 24,
  nearPlayerRadius: 32,
  maxSnapshotVolume: 100_000,
  protectedRegions: [
    {
      name: "arena",
      box: {
        world: "world",
        min: { x: 500, y: -64, z: 500 },
        max: { x: 520, y: 319, z: 520 },
      },
    },
  ],
};

export const LIVE_TEST_TOKEN = "t".repeat(48);

function ignore(): void {
  // Test logs are not asserted.
}

/** One port-forward process that binds immediately; kill ends it. */
export const bindingSpawner: ProcessSpawner = () => {
  const { promise: exited, resolve } = Promise.withResolvers<number>();
  return {
    stdout: new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            "Forwarding from 127.0.0.1:41234 -> 25580\n",
          ),
        );
      },
    }),
    exited,
    kill: () => {
      resolve(0);
    },
  };
};

const noSandboxes: SandboxProvider = {
  kind: "docker",
  preflight: () => Promise.resolve(),
  create: () => Promise.reject(new Error("unused")),
  list: () => Promise.resolve([]),
  destroy: () => Promise.resolve(),
  reap: () => Promise.resolve([]),
  logs: () => Promise.resolve([]),
};

/** A live service over fake kubectl and bridge, plus a daemon context for it. */
export function liveContext(options: {
  runner: KubectlRunner;
  bridge: BridgeClient;
  journal: LiveJournal;
  token?: string;
  config?: LiveGuardConfig;
  now?: () => Date;
}): { ctx: DaemonContext; live: LiveService } {
  const token = options.token ?? LIVE_TEST_TOKEN;
  const live = new LiveService({
    kubectl: new Kubectl(liveKubeTarget("ctx"), options.runner),
    velero: new Kubectl(liveKubeTarget("ctx", "velero"), options.runner),
    token: () => token,
    config: () => Promise.resolve(options.config ?? liveConfig),
    journal: options.journal,
    spawn: bindingSpawner,
    ...(options.now === undefined ? {} : { now: options.now }),
    log: ignore,
    bridge: () => options.bridge,
  });
  const ctx: DaemonContext = {
    provider: noSandboxes,
    live,
    target: (id) =>
      id === "live"
        ? live.target()
        : Promise.reject(new DaemonError(`No sandbox ${id}`, 404)),
    clients: new ClientManager({
      repoRoot: "/repo",
      dir: "/nonexistent",
      launcher: () => {
        throw new Error("live harness never starts a client");
      },
      log: ignore,
    }),
    startedAt: "2026-10-04T00:00:00Z",
    ttlSeconds: 3600,
    repoRoot: "/repo",
    lastActivity: 0,
    log: ignore,
  };
  return { ctx, live };
}
