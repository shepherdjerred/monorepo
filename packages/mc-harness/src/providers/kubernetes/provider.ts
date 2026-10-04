import os from "node:os";
import path from "node:path";
import { BridgeClient } from "#bridge/client.ts";
import type { SandboxCreateRequest } from "#protocol/ipc.ts";
import { CACHE_DIR } from "#protocol/paths.ts";
import {
  newSandboxId,
  newSandboxSecrets,
  waitForBridge,
} from "#sandbox/boot.ts";
import { assertNoPluginFailures } from "#sandbox/paper-log.ts";
import {
  BRIDGE_PORT,
  GAME_PORT,
  RCON_PORT,
  resolveProfile,
} from "#sandbox/profiles.ts";
import type { Progress, SandboxProvider } from "#sandbox/provider.ts";
import {
  kubernetesPod,
  type SandboxRecord,
  type SandboxStore,
} from "#sandbox/record.ts";
import { requireStagedSources, stageSandboxFiles } from "#sandbox/staging.ts";
import { Kubectl, type KubeTarget, type KubectlRunner } from "./kubectl.ts";
import { podIsReapable, podIsServing } from "./pod-state.ts";
import {
  canCreatePods,
  sandboxPods,
  serverLogs,
  waitForDone,
  waitForStage,
} from "./pod-watch.ts";
import {
  buildSandboxPod,
  MAIN_CONTAINER,
  MAX_ACTIVE_DEADLINE_SECONDS,
  sandboxPodName,
  STAGE_CONTAINER,
  STAGING_DIR,
  STAGING_READY,
} from "./pod-manifest.ts";
import {
  PortForward,
  portForwardArgs,
  type ProcessSpawner,
} from "./port-forward.ts";

/** Cold pulls of the storm image take minutes on a fresh node. */
export const CLUSTER_BOOT_TIMEOUT_MS = 600_000;

type Endpoint = { host: string; port: number };
type Endpoints = SandboxRecord["endpoints"];

function endpointsFrom(ports: Map<number, number>): Endpoints {
  const at = (port: number): Endpoint => {
    const local = ports.get(port);
    if (local === undefined) {
      throw new Error(
        `port-forward did not bind container port ${port.toString()}`,
      );
    }
    return { host: "127.0.0.1", port: local };
  };
  return { game: at(GAME_PORT), rcon: at(RCON_PORT), bridge: at(BRIDGE_PORT) };
}

export type KubernetesProviderOptions = {
  repoRoot: string;
  store: SandboxStore;
  target: KubeTarget;
  cacheDir?: string;
  owner?: string;
  runner?: KubectlRunner;
  spawn?: ProcessSpawner;
  /** Waits for MCBridge /v1/health on the forwarded bridge port. */
  health?: (bridge: Endpoint, token: string, deadline: number) => Promise<void>;
  pollMs?: number;
  bootTimeoutMs?: number;
  log?: (message: string, fields?: Record<string, unknown>) => void;
  /** Host-side staging; tests replace the pinned-artifact downloads. */
  stage?: typeof stageSandboxFiles;
};

/**
 * Runs sandboxes as pods in the cluster's mc-sandbox namespace (packages/homelab
 * mc-sandbox chart), impersonating the scoped mc-harness ServiceAccount. Staged
 * files are copied in with `kubectl cp`; the laptop reaches the server through
 * supervised `kubectl port-forward`s, re-attached after a daemon restart. The
 * pod's activeDeadlineSeconds is the hard backstop if the daemon never reaps.
 */
export class KubernetesSandboxProvider implements SandboxProvider {
  readonly kind = "kubernetes" as const;
  private readonly kubectl: Kubectl;
  private readonly forwards = new Map<string, PortForward>();
  private used = false;

  constructor(private readonly options: KubernetesProviderOptions) {
    this.kubectl = new Kubectl(options.target, options.runner);
  }

  private get cacheDir(): string {
    return this.options.cacheDir ?? CACHE_DIR;
  }

  private get owner(): string {
    return this.options.owner ?? `${os.userInfo().username}@${os.hostname()}`;
  }

  private get pollMs(): number {
    return this.options.pollMs ?? 1000;
  }

  private log(message: string, fields?: Record<string, unknown>): void {
    this.options.log?.(message, fields);
  }

  async preflight(): Promise<void> {
    const { context, namespace, as } = this.options.target;
    const answer = await canCreatePods(this.kubectl);
    if (answer.trim() !== "yes") {
      throw new Error(
        `Cluster sandboxes need ${as} to create pods in ${namespace} on context ${context} (the homelab mc-sandbox chart): ${answer.trim()}`,
      );
    }
  }

  async create(
    request: SandboxCreateRequest,
    progress: Progress,
  ): Promise<SandboxRecord> {
    if (request.ttlSeconds > MAX_ACTIVE_DEADLINE_SECONDS) {
      throw new Error(
        `Cluster sandboxes live at most ${(MAX_ACTIVE_DEADLINE_SECONDS / 3600).toString()} h; use --ttl 8h or less`,
      );
    }
    this.used = true;
    const started = Date.now();
    const id = newSandboxId();
    const secrets = newSandboxSecrets();
    const profile = resolveProfile(request, secrets);
    await requireStagedSources(this.options.repoRoot, profile.staged);
    const dir = this.options.store.dir(id);
    progress("staging files");
    const stage = this.options.stage ?? stageSandboxFiles;
    const { pluginsDir, seedFiles } = await stage({
      dir,
      cacheDir: this.cacheDir,
      repoRoot: this.options.repoRoot,
      profile,
    });
    const createdAt = new Date(started).toISOString();
    const expiresAt = new Date(
      started + request.ttlSeconds * 1000,
    ).toISOString();
    const pod = sandboxPodName(id);
    const manifest = buildSandboxPod({
      id,
      profileName: request.profile,
      profile,
      ttlSeconds: request.ttlSeconds,
      expiresAt,
      keep: request.keep,
      owner: this.owner,
    });
    progress("creating pod");
    await this.kubectl.run(["create", "-f", "-"], JSON.stringify(manifest));
    let forward: PortForward | null = null;
    try {
      const deadline =
        started + (this.options.bootTimeoutMs ?? CLUSTER_BOOT_TIMEOUT_MS);
      if (pluginsDir !== null || seedFiles.length > 0) {
        progress("waiting for the stage container");
        await waitForStage(this.kubectl, pod, deadline, this.pollMs);
        progress("copying staged files");
        const inStage = ["-c", STAGE_CONTAINER];
        if (pluginsDir !== null) {
          await this.kubectl.run([
            "cp",
            pluginsDir,
            `${pod}:${STAGING_DIR}/plugins`,
            ...inStage,
          ]);
        }
        if (seedFiles.length > 0) {
          await this.kubectl.run([
            "exec",
            pod,
            ...inStage,
            "--",
            "mkdir",
            "-p",
            `${STAGING_DIR}/data`,
          ]);
          for (const seed of seedFiles) {
            await this.kubectl.run([
              "cp",
              seed.source,
              `${pod}:${STAGING_DIR}/data/${seed.target}`,
              ...inStage,
            ]);
          }
        }
        await this.kubectl.run([
          "exec",
          pod,
          ...inStage,
          "--",
          "touch",
          STAGING_READY,
        ]);
      }
      progress("booting Paper");
      assertNoPluginFailures(
        await waitForDone(this.kubectl, pod, deadline, this.pollMs),
      );
      progress("forwarding ports");
      forward = this.newForward(id, pod, profile.ports);
      const endpoints = endpointsFrom(await forward.start());
      progress("waiting for MCBridge");
      await this.health(endpoints.bridge, secrets.bridgeToken, deadline);
      const record: SandboxRecord = {
        id,
        provider: "kubernetes",
        profile: request.profile,
        world: request.world,
        status: "ready",
        createdAt,
        expiresAt,
        keep: request.keep,
        bootMs: Date.now() - started,
        endpoints,
        providerRef: {
          kind: "kubernetes",
          context: this.options.target.context,
          namespace: this.options.target.namespace,
          pod,
        },
        owner: this.owner,
        secrets,
      };
      await this.options.store.write(record);
      this.forwards.set(id, forward);
      return record;
    } catch (error) {
      forward?.stop();
      const logs = await serverLogs(this.kubectl, pod).catch(() => "");
      await Bun.write(path.join(dir, "failed-boot.log"), logs);
      await this.kubectl
        .run(["delete", "pod", pod, "--ignore-not-found", "--wait=false"])
        .catch(() => null);
      throw error;
    }
  }

  async list(): Promise<SandboxRecord[]> {
    const records = await this.options.store.listFor("kubernetes");
    if (records.length === 0) {
      return [];
    }
    this.used = true;
    const pods = await sandboxPods(this.kubectl);
    const listed: SandboxRecord[] = [];
    for (const record of records) {
      const serving = podIsServing(pods.get(record.id));
      if (!serving) {
        this.forwards.get(record.id)?.stop();
        this.forwards.delete(record.id);
        listed.push({ ...record, status: "stopped" });
        continue;
      }
      try {
        listed.push({ ...(await this.ensureForward(record)), status: "ready" });
      } catch (error) {
        this.log("port-forward re-attach failed", {
          id: record.id,
          error: error instanceof Error ? error.message : String(error),
        });
        listed.push({ ...record, status: "stopped" });
      }
    }
    return listed;
  }

  async destroy(id: string): Promise<void> {
    const record = await this.options.store.read(id);
    this.forwards.get(id)?.stop();
    this.forwards.delete(id);
    const pod =
      record === null ? sandboxPodName(id) : kubernetesPod(record).pod;
    const { stdout } = await this.kubectl.run([
      "delete",
      "pod",
      pod,
      "--ignore-not-found",
      "--wait=false",
    ]);
    if (record === null && stdout.trim().length === 0) {
      throw new Error(`No sandbox ${id}`);
    }
    await this.options.store.remove(id);
  }

  async reap(now: Date): Promise<string[]> {
    const records = await this.options.store.listFor("kubernetes");
    if (records.length === 0 && !this.used) {
      return [];
    }
    const reaped: string[] = [];
    const pods = await sandboxPods(this.kubectl);
    for (const [id, pod] of pods) {
      if (podIsReapable(pod, now)) {
        await this.destroy(id);
        reaped.push(id);
      }
    }
    // Records whose pod vanished (deleted by hand, node drained).
    for (const record of records) {
      if (!pods.has(record.id) && !reaped.includes(record.id)) {
        this.forwards.get(record.id)?.stop();
        this.forwards.delete(record.id);
        await this.options.store.remove(record.id);
        reaped.push(record.id);
      }
    }
    return reaped;
  }

  async logs(record: SandboxRecord, tail: number): Promise<string[]> {
    const { stdout } = await this.kubectl.run([
      "logs",
      kubernetesPod(record).pod,
      "-c",
      MAIN_CONTAINER,
      "--tail",
      tail.toString(),
    ]);
    return stdout.split("\n").filter((line) => line.length > 0);
  }

  private async health(
    bridge: Endpoint,
    token: string,
    deadline: number,
  ): Promise<void> {
    if (this.options.health !== undefined) {
      await this.options.health(bridge, token, deadline);
      return;
    }
    await waitForBridge(
      new BridgeClient(
        { baseUrl: `http://${bridge.host}:${bridge.port.toString()}`, token },
        5000,
      ),
      deadline,
    );
  }

  private newForward(
    id: string,
    pod: string,
    ports: readonly number[],
  ): PortForward {
    return new PortForward({
      argv: this.kubectl.argv(portForwardArgs(pod, ports)),
      ports,
      ...(this.options.spawn === undefined
        ? {}
        : { spawn: this.options.spawn }),
      onRestart: (bound) => {
        void this.rewriteEndpoints(id, endpointsFrom(bound));
      },
      onError: (error) => {
        this.log("port-forward restart failed", {
          id,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    });
  }

  /** Starts a forward for a sandbox this daemon did not create (after a restart). */
  private async ensureForward(record: SandboxRecord): Promise<SandboxRecord> {
    if (this.forwards.get(record.id)?.active === true) {
      return record;
    }
    const forward = this.newForward(record.id, kubernetesPod(record).pod, [
      GAME_PORT,
      RCON_PORT,
      BRIDGE_PORT,
    ]);
    const endpoints = endpointsFrom(await forward.start());
    this.forwards.set(record.id, forward);
    const updated = { ...record, endpoints };
    await this.options.store.write(updated);
    return updated;
  }

  private async rewriteEndpoints(
    id: string,
    endpoints: Endpoints,
  ): Promise<void> {
    const record = await this.options.store.read(id);
    if (record !== null) {
      await this.options.store.write({ ...record, endpoints });
    }
  }
}
