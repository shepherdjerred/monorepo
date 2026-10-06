import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CACHE_DIR } from "#protocol/paths.ts";
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

export const LABELS = {
  sandbox: "mc-harness.sandbox",
  profile: "mc-harness.profile",
  expiresAt: "mc-harness.expires-at",
  owner: "mc-harness.owner",
  keep: "mc-harness.keep",
} as const;

/** `docker create` argv for a sandbox; pure so the label/port shape is tested. */
export function dockerCreateArgs(options: {
  id: string;
  profileName: string;
  profile: ResolvedProfile;
  /** Null when the profile stages no plugins (the image keeps its own). */
  pluginsDir: string | null;
  cacheDir: string;
  expiresAt: string;
  owner: string;
  keep: boolean;
}): string[] {
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
    ...options.profile.ports.flatMap((port) => [
      "-p",
      `127.0.0.1::${port.toString()}`,
    ]),
    // An image that bakes its own /plugins (the storm image) keeps them. A
    // file overlay masks only the selected config file; mounting the staging
    // directory over /plugins would hide every baked plugin.
    ...(options.pluginsDir === null
      ? []
      : options.profile.stagedPluginMount === "files"
        ? options.profile.staged.flatMap((entry) => [
            "-v",
            `${path.join(options.pluginsDir ?? "", entry.target)}:/plugins/${entry.target}:ro`,
          ])
        : ["-v", `${options.pluginsDir}:/plugins:ro`]),
    ...(options.profile.seedData ? warmMountArgs(options.cacheDir) : []),
    ...envArgs(options.profile.env),
    options.profile.image,
  ];
}

export type SandboxRow = {
  containerId: string;
  id: string;
  expiresAt: string;
  keep: boolean;
  running: boolean;
  /** Exited or dead: unusable. A just-created container is not stale. */
  stale: boolean;
};

/** Parses `docker ps -a` rows formatted by `SANDBOX_ROW_FORMAT`. */
export function parseSandboxRows(stdout: string): SandboxRow[] {
  return stdout
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [containerId = "", id = "", expiresAt = "", keep = "", state = ""] =
        line.split("\t");
      return {
        containerId,
        id,
        expiresAt,
        keep: keep === "true",
        running: state === "running",
        stale: state === "exited" || state === "dead",
      };
    });
}

export const SANDBOX_ROW_FORMAT = `{{.ID}}\t{{.Label "${LABELS.sandbox}"}}\t{{.Label "${LABELS.expiresAt}"}}\t{{.Label "${LABELS.keep}"}}\t{{.State}}`;

/**
 * Runs sandboxes as local Docker containers from the pinned itzg image. Creates
 * are serialized: concurrent boots would share and race on the Paperclip warm
 * cache.
 */
export class DockerSandboxProvider implements SandboxProvider {
  readonly kind = "docker" as const;
  private queue: Promise<unknown> = Promise.resolve();

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
    return this.options.owner ?? `${os.userInfo().username}@${os.hostname()}`;
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
    const profile = resolveProfile(request, secrets);
    // Fail on a missing build output before writing anything.
    await requireStagedSources(this.options.repoRoot, profile.staged);
    const dir = this.options.store.dir(id);
    progress("staging plugins");
    const { pluginsDir, seedFiles } = await stageSandboxFiles({
      dir,
      cacheDir: this.cacheDir,
      repoRoot: this.options.repoRoot,
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
      for (const seed of seedFiles) {
        await docker([
          "cp",
          seed.source,
          `${containerId}:/data/${seed.target}`,
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
      const record: SandboxRecord = {
        id,
        provider: "docker",
        profile: request.profile,
        world: request.world,
        status: "ready",
        createdAt,
        expiresAt,
        keep: request.keep,
        bootMs: Date.now() - started,
        endpoints: { game, rcon, bridge },
        providerRef: { kind: "docker", containerId },
        owner: this.owner,
        secrets,
      };
      await this.options.store.write(record);
      return record;
    } catch (error) {
      const logs = await containerLogs(containerId).catch(() => "");
      await Bun.write(path.join(dir, "failed-boot.log"), logs);
      await docker(["rm", "-f", "-v", containerId]);
      throw error;
    }
  }

  async list(): Promise<SandboxRecord[]> {
    const records = await this.options.store.listFor("docker");
    const rows = await this.rows();
    const running = new Set(
      rows
        .filter((row) => row.running)
        .map((row) => row.containerId.slice(0, 12)),
    );
    return records.map((record) => ({
      ...record,
      status: running.has(dockerContainerId(record).slice(0, 12))
        ? "ready"
        : "stopped",
    }));
  }

  async destroy(id: string): Promise<void> {
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
    const rows = await this.rows();
    for (const row of rows) {
      const expired = !row.keep && Date.parse(row.expiresAt) <= now.getTime();
      // An exited sandbox is unusable whether or not it was kept.
      if ((expired || row.stale) && !reaped.includes(row.id)) {
        await this.destroy(row.id);
        reaped.push(row.id);
      }
    }
    // Docker records whose container vanished (docker restart, manual rm).
    const remaining = await this.rows();
    const known = new Set(remaining.map((row) => row.id));
    for (const record of await this.options.store.listFor("docker")) {
      if (!known.has(record.id) && !reaped.includes(record.id)) {
        await this.options.store.remove(record.id);
        reaped.push(record.id);
      }
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
      "--format",
      SANDBOX_ROW_FORMAT,
    ]);
    return parseSandboxRows(stdout);
  }
}
