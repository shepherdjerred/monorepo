import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  BRIDGE_BUILD_COMMAND,
  BRIDGE_JAR,
  CACHE_DIR,
} from "#protocol/paths.ts";
import type { SandboxCreateRequest } from "#protocol/ipc.ts";
import { BridgeClient } from "#bridge/client.ts";
import { paper } from "#src/pins.ts";
import {
  BRIDGE_PORT,
  GAME_PORT,
  RCON_PORT,
  resolveProfile,
  type ResolvedProfile,
} from "#sandbox/profiles.ts";
import type { Progress, SandboxProvider } from "#sandbox/provider.ts";
import type { SandboxRecord, SandboxStore } from "#sandbox/record.ts";
import { docker } from "./docker-cli.ts";
import {
  containerLogs,
  ensureArtifact,
  envArgs,
  paperJarName,
  publishedPort,
  startAndAwaitDone,
  warmMountArgs,
  warmMounts,
  writeThrottleFreeBukkitYml,
} from "./paper-container.ts";

export const LABELS = {
  sandbox: "mc-harness.sandbox",
  profile: "mc-harness.profile",
  expiresAt: "mc-harness.expires-at",
  owner: "mc-harness.owner",
  keep: "mc-harness.keep",
} as const;

const BOOT_TIMEOUT_MS = 240_000;

export function newSandboxId(): `sbx-${string}` {
  return `sbx-${randomBytes(3).toString("hex")}`;
}

/** `docker create` argv for a sandbox; pure so the label/port shape is tested. */
export function dockerCreateArgs(options: {
  id: string;
  profileName: string;
  profile: ResolvedProfile;
  pluginsDir: string;
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
    "-v",
    `${options.pluginsDir}:/plugins:ro`,
    ...warmMountArgs(options.cacheDir),
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
    const bridgeJar = path.join(this.options.repoRoot, BRIDGE_JAR);
    if (!(await Bun.file(bridgeJar).exists())) {
      throw new Error(
        `MCBridge.jar is not built (${bridgeJar}). Build it first:\n  ${BRIDGE_BUILD_COMMAND}`,
      );
    }
    const id = newSandboxId();
    const secrets = {
      bridgeToken: randomBytes(24).toString("hex"),
      rconPassword: randomBytes(24).toString("hex"),
    };
    const profile = resolveProfile(request, secrets);
    const dir = this.options.store.dir(id);
    const pluginsDir = path.join(dir, "plugins");
    await mkdir(pluginsDir, { recursive: true, mode: 0o700 });
    const downloads = path.join(this.cacheDir, "plugins");
    await mkdir(downloads, { recursive: true });

    progress("staging plugins");
    for (const pin of profile.plugins) {
      const jar = `${pin.name}-${pin.version}.jar`;
      await ensureArtifact(path.join(downloads, jar), pin);
      await Bun.write(
        path.join(pluginsDir, jar),
        Bun.file(path.join(downloads, jar)),
      );
    }
    await Bun.write(path.join(pluginsDir, "MCBridge.jar"), Bun.file(bridgeJar));
    const paperJar = path.join(this.cacheDir, paperJarName);
    await ensureArtifact(paperJar, paper);
    await Promise.all(
      warmMounts.map(async ([warm]) =>
        mkdir(path.join(this.cacheDir, warm), { recursive: true }),
      ),
    );
    const bukkitYml = path.join(dir, "bukkit.yml");
    await writeThrottleFreeBukkitYml(bukkitYml);

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
      await docker(["cp", bukkitYml, `${containerId}:/data/bukkit.yml`]);
      await docker(["cp", paperJar, `${containerId}:/data/${paperJarName}`]);
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
        containerId,
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
    const records = await this.options.store.list();
    const rows = await this.rows();
    const running = new Set(
      rows
        .filter((row) => row.running)
        .map((row) => row.containerId.slice(0, 12)),
    );
    return records.map((record) => ({
      ...record,
      status: running.has(record.containerId.slice(0, 12))
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
        : [record?.containerId ?? ""];
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
    // Records whose container vanished (docker restart, manual rm).
    const remaining = await this.rows();
    const known = new Set(remaining.map((row) => row.id));
    for (const record of await this.options.store.list()) {
      if (!known.has(record.id) && !reaped.includes(record.id)) {
        await this.options.store.remove(record.id);
        reaped.push(record.id);
      }
    }
    return reaped;
  }

  async logs(record: SandboxRecord, tail: number): Promise<string[]> {
    const text = await containerLogs(record.containerId, tail);
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

async function waitForBridge(
  client: BridgeClient,
  deadline: number,
): Promise<void> {
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      await client.health();
      return;
    } catch (error) {
      last = error;
      await Bun.sleep(500);
    }
  }
  throw new Error(
    `MCBridge did not answer /v1/health before the boot deadline: ${last instanceof Error ? last.message : String(last)}`,
  );
}
