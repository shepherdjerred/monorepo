import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CACHE_DIR } from "#protocol/paths.ts";
import { instanceOwner } from "#protocol/instance.ts";
import { stageWorldDirectory } from "#sandbox/world-source.ts";
import { copyRealMap } from "#sandbox/map-copy.ts";
import { startCaptureProxy } from "./proxy.ts";
import { SandboxLifecycle } from "./lifecycle.ts";
import type { SandboxCreateRequest } from "#protocol/ipc.ts";
import { BridgeClient } from "#bridge/client.ts";
import {
  BOOT_TIMEOUT_MS,
  newSandboxId,
  newSandboxSecrets,
  waitForBridge,
} from "#sandbox/boot.ts";
import {
  BRIDGE_PORT,
  GAME_PORT,
  RCON_PORT,
  resolveProfile,
  pluginMountTargets,
  type ResolvedProfile,
} from "#sandbox/profiles.ts";
import type { Progress, SandboxProvider } from "#sandbox/provider.ts";
import { requireStagedSources, stageSandboxFiles } from "#sandbox/staging.ts";
import {
  dockerContainerId,
  type SandboxRecord,
  type SandboxStore,
} from "#sandbox/record.ts";
import { docker } from "./docker-cli.ts";
import {
  containerLogs,
  envArgs,
  publishedPort,
  startAndAwaitDone,
  warmMountArgs,
  warmMounts,
} from "./paper-container.ts";

import {
  LABELS,
  parseSandboxRows,
  SANDBOX_ROW_FORMAT,
  currentDockerEndpoints,
} from "./rows.ts";

function isPublishedStorm(profileName: string): boolean {
  return profileName === "storm-prod" || profileName === "storm-candidate";
}

/** `docker create` argv for a sandbox; pure so the label/port shape is tested. */
export function dockerCreateArgs(
  options: {
    id: string;
    profileName: string;
    profile: ResolvedProfile;
    /** Null when the profile stages no plugins (the image keeps its own). */
    pluginsDir: string | null;
    cacheDir: string;
    expiresAt: string;
    owner: string;
    keep: boolean;
  },
  platform: NodeJS.Platform = process.platform,
): string[] {
  const pluginsDir = options.pluginsDir;
  return [
    "create",
    "--name",
    `mc-harness-${options.id}`,
    "--label",
    `${LABELS.sandbox}=${options.id}`,
    "--label",
    `${LABELS.profile}=${options.profileName}`,
    "--label",
    `${LABELS.expiresAt}=${options.expiresAt}`,
    "--label",
    `${LABELS.owner}=${options.owner}`,
    "--label",
    `${LABELS.keep}=${options.keep.toString()}`,
    ...(platform === "linux" &&
    options.profile.env["FLIPT_URL"]?.startsWith(
      "http://host.docker.internal:",
    ) === true
      ? ["--add-host", "host.docker.internal:host-gateway"]
      : []),
    ...(isPublishedStorm(options.profileName)
      ? [
          "--user",
          "1000:3000",
          "--group-add",
          "2000",
          "--mount",
          "type=volume,destination=/data,volume-nocopy",
        ]
      : []),
    ...options.profile.ports.flatMap((port) => [
      "-p",
      `127.0.0.1::${port.toString()}`,
    ]),
    // An image that bakes its own /plugins (the storm image) keeps them.
    ...(pluginsDir === null
      ? []
      : pluginMountTargets(options.profile).flatMap((target) => [
          "-v",
          `${path.join(pluginsDir, target)}:${path.posix.join("/plugins", target)}:ro`,
        ])),
    ...(options.profile.seedData ? warmMountArgs(options.cacheDir) : []),
    ...envArgs(options.profile.env),
    options.profile.image,
  ];
}

/**
 * Runs sandboxes as local Docker containers from the pinned itzg image. Creates
 * are serialized: concurrent boots would share and race on the Paperclip warm
 * cache.
 */
export class DockerSandboxProvider implements SandboxProvider {
  readonly kind = "docker" as const;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly proxies = new Map<
    string,
    Awaited<ReturnType<typeof startCaptureProxy>>
  >();
  private readonly lifecycle = new SandboxLifecycle();

  constructor(
    private readonly options: {
      repoRoot: string;
      store: SandboxStore;
      cacheDir?: string;
      owner?: string;
    },
  ) {}

  private get cacheDir(): string {
    return this.options.cacheDir ?? CACHE_DIR;
  }

  private get owner(): string {
    return instanceOwner(
      this.options.owner ?? `${os.userInfo().username}@${os.hostname()}`,
      Bun.env["TOOLKIT_MC_INSTANCE"],
    );
  }

  async preflight(): Promise<void> {
    try {
      await docker(["info", "--format", "{{.ServerVersion}}"]);
    } catch (error) {
      throw new Error(
        `Docker is not available for sandboxes: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  async create(
    request: SandboxCreateRequest,
    progress: Progress,
  ): Promise<SandboxRecord> {
    const previous = this.queue;
    const turn = Promise.withResolvers<null>();
    this.queue = turn.promise;
    try {
      await previous;
      return await this.createNow(request, progress);
    } finally {
      turn.resolve(null);
    }
  }

  private async createNow(
    request: SandboxCreateRequest,
    progress: Progress,
  ): Promise<SandboxRecord> {
    const started = Date.now();
    const id = newSandboxId();
    const secrets = newSandboxSecrets();
    const dir = this.options.store.dir(id);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const mapSource =
      request.mapDirectory === undefined
        ? undefined
        : await copyRealMap(request.mapDirectory, path.join(dir, "world"));
    const profile = resolveProfile(request, secrets, mapSource);
    // Validate build outputs before creating a container.
    const sourceDirectory = request.sourceDirectory ?? this.options.repoRoot;
    await requireStagedSources(sourceDirectory, profile.staged);
    progress("staging plugins");
    const { pluginsDir, seedFiles } = await stageSandboxFiles({
      dir,
      cacheDir: this.cacheDir,
      repoRoot: sourceDirectory,
      profile,
    });
    if (profile.seedData) {
      await Promise.all(
        warmMounts.map(async ([warm]) =>
          mkdir(path.join(this.cacheDir, warm), { recursive: true }),
        ),
      );
    }

    const createdAt = new Date(started).toISOString();
    const expiresAt = new Date(
      started + request.ttlSeconds * 1000,
    ).toISOString();
    const { stdout } = await docker(
      dockerCreateArgs({
        id,
        profileName: request.profile,
        profile,
        pluginsDir,
        cacheDir: this.cacheDir,
        expiresAt,
        owner: this.owner,
        keep: request.keep,
      }),
    );
    const containerId = stdout.trim();
    try {
      await this.copySavedWorld(request, dir, containerId, progress);
      if (mapSource !== undefined)
        await docker(["cp", path.join(dir, "world"), `${containerId}:/data/`]);
      if (isPublishedStorm(request.profile)) {
        // Match the server chart's fsGroup on a fresh volume, as boot-check.sh
        // does. The server itself stays unprivileged; only these short-lived
        // helpers touch the disposable volume before the first boot.
        for (const [command, value] of [
          ["chown", "1000:2000"],
          ["chmod", "2775"],
        ] as const) {
          await docker([
            "run",
            "--rm",
            "--user",
            "0:0",
            "--volumes-from",
            containerId,
            "--entrypoint",
            command,
            profile.image,
            value,
            "/data",
          ]);
        }
      }
      for (const seed of seedFiles) {
        await docker([
          "cp",
          seed.source,
          `${containerId}:/data/${seed.target}`,
        ]);
      }
      if (mapSource !== undefined) {
        const config = path.join(dir, "config");
        await mkdir(config, { mode: 0o777 });
        await Bun.write(
          path.join(config, "paper-global.yml"),
          "_version: 31\nproxies:\n  proxy-protocol: true\n",
        );
        await docker(["cp", config, `${containerId}:/data/`]);
        await docker([
          "run",
          "--rm",
          "--volumes-from",
          containerId,
          "--entrypoint",
          "chmod",
          profile.image,
          "-R",
          "a+rwX",
          "/data/config",
        ]);
      }
      progress("booting Paper");
      const deadline = started + BOOT_TIMEOUT_MS;
      await startAndAwaitDone(containerId, deadline);
      const [game, rcon, bridge] = await Promise.all([
        publishedPort(containerId, GAME_PORT),
        publishedPort(containerId, RCON_PORT),
        publishedPort(containerId, BRIDGE_PORT),
      ]);
      progress("waiting for MCBridge");
      await waitForBridge(
        new BridgeClient(
          {
            baseUrl: `http://${bridge.host}:${bridge.port.toString()}`,
            token: secrets.bridgeToken,
          },
          5000,
        ),
        deadline,
      );
      const proxy =
        mapSource === undefined ? undefined : await startCaptureProxy(game);
      if (proxy !== undefined) this.proxies.set(id, proxy);
      const record: SandboxRecord = {
        id,
        provider: "docker",
        profile: request.profile,
        world: request.world,
        ...(request.sourceDirectory === undefined
          ? {}
          : { sourceDirectory: request.sourceDirectory }),
        ...(mapSource === undefined ? {} : { mapSource }),
        ...(request.rollout === undefined ? {} : { rollout: request.rollout }),
        ...(request.captureFeatures === undefined
          ? {}
          : { captureFeatures: request.captureFeatures }),
        status: "ready",
        createdAt,
        expiresAt,
        keep: request.keep,
        bootMs: Date.now() - started,
        endpoints: { game: proxy?.endpoint ?? game, rcon, bridge },
        providerRef: { kind: "docker", containerId },
        owner: this.owner,
        secrets,
      };
      await this.options.store.write(record);
      return record;
    } catch (error) {
      this.proxies.get(id)?.close();
      this.proxies.delete(id);
      const logs = await containerLogs(containerId).catch(() => "");
      await Bun.write(path.join(dir, "failed-boot.log"), logs);
      await docker(["rm", "-f", "-v", containerId]);
      throw error;
    }
  }

  private async copySavedWorld(
    request: SandboxCreateRequest,
    dir: string,
    containerId: string,
    progress: Progress,
  ): Promise<void> {
    if (request.worldDirectory === undefined) return;
    progress("copying saved world into the stopped container");
    const world = path.join(dir, "seed-world");
    await stageWorldDirectory(request.worldDirectory, world);
    await docker(["cp", world, `${containerId}:/data/world`]);
  }

  async list(): Promise<SandboxRecord[]> {
    const records = await this.options.store.listFor("docker");
    const rows = await this.rows();
    const running = new Map(
      rows
        .filter((row) => row.running)
        .map((row) => [row.containerId.slice(0, 12), row]),
    );
    const listed = await Promise.all(
      records.map((record) =>
        this.lifecycle.run(record.id, async () => {
          const current = await this.options.store.read(record.id);
          if (current === null) return;
          const row = running.get(dockerContainerId(current).slice(0, 12));
          if (row === undefined)
            return { ...current, status: "stopped" as const };
          const adopted =
            current.world === "real-map"
              ? await this.adopt(current)
              : {
                  ...current,
                  endpoints: currentDockerEndpoints(row.ports),
                };
          return { ...adopted, status: "ready" as const };
        }),
      ),
    );
    return listed.filter((record) => record !== undefined);
  }

  private async adopt(record: SandboxRecord): Promise<SandboxRecord> {
    const existing = this.proxies.get(record.id);
    if (existing !== undefined)
      return {
        ...record,
        endpoints: { ...record.endpoints, game: existing.endpoint },
      };
    const game = await publishedPort(dockerContainerId(record), GAME_PORT);
    const proxy = await startCaptureProxy(game);
    const adopted = {
      ...record,
      endpoints: { ...record.endpoints, game: proxy.endpoint },
    };
    try {
      await this.options.store.write(adopted);
      this.proxies.set(record.id, proxy);
      return adopted;
    } catch (error) {
      proxy.close();
      throw error;
    }
  }

  async destroy(id: string): Promise<void> {
    return this.lifecycle.run(id, () => this.destroyNow(id));
  }

  private async destroyNow(id: string): Promise<void> {
    this.proxies.get(id)?.close();
    this.proxies.delete(id);
    const record = await this.options.store.read(id);
    const allRows = await this.rows();
    const rows = allRows.filter((row) => row.id === id);
    if (record === null && rows.length === 0) {
      throw new Error(`No sandbox ${id}`);
    }
    // Labels find the container even when the record is gone; `docker ps`
    // reports short ids, so the record's full id is only a fallback.
    const containers =
      rows.length > 0
        ? rows.map((row) => row.containerId)
        : [record === null ? "" : dockerContainerId(record)];
    for (const container of containers) {
      try {
        await docker(["rm", "-f", "-v", container]);
      } catch (error) {
        if (!(error instanceof Error && error.message.includes("No such"))) {
          throw error;
        }
      }
    }
    await this.options.store.remove(id);
  }

  async reap(now: Date): Promise<string[]> {
    const reaped: string[] = [];
    const records = await this.options.store.listFor("docker");
    const rows = await this.rows();
    const candidates = new Set([
      ...records.map((record) => record.id),
      ...rows.map((row) => row.id),
    ]);
    for (const id of candidates) {
      const removed = await this.lifecycle.run(id, async () => {
        // Read the record before a fresh Docker inventory. A newly published
        // creation cannot become a missing-container candidate from an old scan.
        const record = await this.options.store.read(id);
        const inventory = await this.rows();
        const current = inventory.filter((row) => row.id === id);
        const expired = current.some(
          (row) => !row.keep && Date.parse(row.expiresAt) <= now.getTime(),
        );
        const stale = current.some((row) => row.stale);
        if (!expired && !stale && !(record !== null && current.length === 0))
          return false;
        await this.destroyNow(id);
        return true;
      });
      if (removed) reaped.push(id);
    }
    return reaped;
  }

  async logs(record: SandboxRecord, tail: number): Promise<string[]> {
    const text = await containerLogs(dockerContainerId(record), tail);
    return text.split("\n").filter((line) => line.length > 0);
  }

  private async rows() {
    const { stdout } = await docker([
      "ps",
      "-a",
      "--filter",
      `label=${LABELS.sandbox}`,
      "--filter",
      `label=${LABELS.owner}=${this.owner}`,
      "--format",
      SANDBOX_ROW_FORMAT,
    ]);
    return parseSandboxRows(stdout);
  }
}
