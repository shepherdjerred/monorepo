import { createHash, randomBytes } from "node:crypto";
import { chmod, cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { docker } from "./docker.ts";
import { stageCompanionsE2e } from "./companions-e2e.ts";
import {
  overlayAgentTopLevel,
  overlayBrainUrl,
  overlayRwf,
  overlaySweep,
  type RwfOverlay,
} from "./config-overlays.ts";
import {
  paper,
  serverImage,
  thirdPartyPlugins,
  type PluginPin,
} from "./pins.ts";
import { RconClient } from "#e2e/harness/rcon.ts";

const ownerLabel = "the-storm.e2e";
const pidLabel = "the-storm.e2e.pid";

const ConnectionShape = {
  host: z.string().min(1),
  gamePort: z.number().int().positive(),
  rconPort: z.number().int().positive(),
  rconPassword: z.string().min(16),
};

// A server this run started in Docker, or one CI runs as a sidecar and whose
// log file it shares with the test container.
export const ServerInfoSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("container"),
    containerId: z.string().min(12),
    bootMs: z.number(),
    ...ConnectionShape,
  }),
  z.object({
    kind: z.literal("external"),
    logFile: z.string().min(1),
    ...ConnectionShape,
  }),
]);
export type ServerInfo = z.infer<typeof ServerInfoSchema>;

export type StartedServer = {
  info: ServerInfo;
  stop: () => Promise<void>;
};

export type StartServerOptions = {
  cacheDir: string;
  bootTimeoutMs: number;
  /**
   * Seed the pinned Paper jar and share Paperclip's and LuckPerms' downloaded
   * libraries across runs, so boot needs no network after the first run.
   */
  warmCache: boolean;
  /** The built TheStorm.jar under test. */
  stormJar: string;
  mechanicsE2eJar?: string;
  mechanicsConfig?: string;
  fixturesJar?: string;
  companionsE2eJar?: string;
  /** Overrides for the staged rwf.yml when the suite plays Search and Destroy. */
  rwf?: RwfOverlay;
  /** Contents of plugins/TheStorm/config.yml. */
  stormConfig: string;
  /**
   * Container environment beyond the server basics: the Flipt gate address and
   * the recording salt the modules under test read at enable.
   */
  env: Record<string, string>;
  /** Repository-owned plugin config directory. */
  ownedConfigDir: string;
  /** Fake brain the staged agent.yml points at. */
  brain: { baseUrl: string; token: string };
  sweep: {
    intervalMinutes: number;
    redriveAfterMinutes: number;
    redriveBackoffMinutes: number;
    slaAfterMinutes: number;
  };
  agent: { mode: string; reviewSamplePercent: number };
  /**
   * Container limits for a profile that measures load; the default is a 1G
   * heap with no CPU or memory limit.
   */
  resources?: ServerResources;
  /**
   * Publish the game port on this fixed loopback port, so a real client can
   * join `localhost`; a random free port otherwise.
   */
  gamePort?: number;
};

/** Docker limits and the JVM heap (itzg's MEMORY) for the server container. */
export type ServerResources = {
  cpus: number;
  /** The JVM heap, as itzg's MEMORY reads it (8G). */
  heap: string;
  /** The container memory limit, as `docker create --memory` reads it (10g). */
  memoryLimit: string;
};

const PortBindingSchema = z
  .string()
  .trim()
  .regex(/^[\d.]+:\d+$/u)
  .transform((binding) => {
    const [host = "", port = ""] = binding.split(":");
    return { host, port: Number(port) };
  });

const OwnedStormConfigSchema = z
  .object({ modules: z.record(z.string(), z.boolean()) })
  .strict();

/**
 * Turns the repository-owned config.yml into one with every module disabled.
 * The plugin rejects a config that omits a module, so the key set always
 * follows the owned file.
 */
export function stormTestConfig(ownedYaml: string, enabled: string[]): string {
  const owned = OwnedStormConfigSchema.parse(Bun.YAML.parse(ownedYaml));
  const known = new Set(Object.keys(owned.modules));
  const unknown = enabled.filter((module) => !known.has(module));
  if (unknown.length > 0) {
    throw new Error(`Unknown modules: ${unknown.join(", ")}`);
  }
  const on = new Set(enabled);
  const modules = Object.keys(owned.modules).map(
    (module) => `  ${module}: ${on.has(module).toString()}`,
  );
  return ["modules:", ...modules, ""].join("\n");
}

async function download(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${response.status.toString()}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/** Downloads once into the cache and verifies the pinned sha256 on every run. */
async function ensureArtifact(
  file: string,
  pin: Pick<PluginPin, "url" | "sha256">,
): Promise<void> {
  const cached = Bun.file(file);
  const exists = await cached.exists();
  const bytes = exists
    ? new Uint8Array(await cached.arrayBuffer())
    : await download(pin.url);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== pin.sha256) {
    throw new Error(
      `${path.basename(file)} sha256 mismatch: expected ${pin.sha256}, got ${actual}`,
    );
  }
  if (!exists) {
    await Bun.write(file, bytes);
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Removes containers and staging dirs left by runner processes that no longer exist. */
async function reapOrphans(runsDir: string): Promise<void> {
  const { stdout } = await docker([
    "ps",
    "-a",
    "--filter",
    `label=${ownerLabel}`,
    "--format",
    `{{.ID}} {{.Label "${pidLabel}"}}`,
  ]);
  for (const entry of stdout.split("\n").filter(Boolean)) {
    const [id = "", pid = ""] = entry.split(" ");
    if (!isAlive(Number(pid))) {
      await docker(["rm", "-f", "-v", id]);
    }
  }
  for (const pid of await readdir(runsDir)) {
    if (!isAlive(Number(pid))) {
      await rm(path.join(runsDir, pid), { recursive: true, force: true });
    }
  }
}

async function publishedPort(
  containerId: string,
  port: number,
): Promise<{ host: string; port: number }> {
  const { stdout } = await docker([
    "port",
    containerId,
    `${port.toString()}/tcp`,
  ]);
  // Docker may list an IPv6 binding too; the IPv4 loopback one comes first.
  return PortBindingSchema.parse(stdout.split("\n")[0]);
}

async function waitForLog(
  containerId: string,
  pattern: RegExp,
  deadline: number,
): Promise<void> {
  for (;;) {
    const { stdout, stderr } = await docker(["logs", containerId]);
    if (pattern.test(stdout) || pattern.test(stderr)) {
      return;
    }
    const tail = `${stdout.slice(-4000)}\n${stderr.slice(-4000)}`;
    const { stdout: state } = await docker([
      "inspect",
      "-f",
      "{{.State.Running}}",
      containerId,
    ]);
    if (state.trim() !== "true") {
      throw new Error(`Server exited before ready:\n${tail}`);
    }
    if (Date.now() > deadline) {
      throw new Error(`Server not ready before deadline:\n${tail}`);
    }
    await Bun.sleep(500);
  }
}

/**
 * Builds this run's /plugins mount: the pinned third-party jars, the plugin
 * under test and its repository-owned config directory.
 */
export async function stagePlugins(
  cacheDir: string,
  stagingDir: string,
  options: Pick<
    StartServerOptions,
    | "stormJar"
    | "stormConfig"
    | "mechanicsE2eJar"
    | "mechanicsConfig"
    | "fixturesJar"
    | "companionsE2eJar"
    | "rwf"
    | "warmCache"
  > &
    Partial<
      Pick<StartServerOptions, "ownedConfigDir" | "brain" | "sweep" | "agent">
    >,
): Promise<string> {
  const downloads = path.join(cacheDir, "plugins");
  const pluginsDir = path.join(stagingDir, "plugins");
  await mkdir(downloads, { recursive: true });
  await mkdir(pluginsDir, { recursive: true });
  for (const pin of thirdPartyPlugins) {
    const jar = `${pin.name}-${pin.version}.jar`;
    await ensureArtifact(path.join(downloads, jar), pin);
    await Bun.write(
      path.join(pluginsDir, jar),
      Bun.file(path.join(downloads, jar)),
    );
  }
  await Bun.write(
    path.join(pluginsDir, "TheStorm.jar"),
    Bun.file(options.stormJar),
  );
  if (options.ownedConfigDir !== undefined) {
    await cp(options.ownedConfigDir, path.join(pluginsDir, "TheStorm"), {
      recursive: true,
    });
    // Citizens' owned config keeps rwfbots' NPCs off the tab and online
    // lists, as the production image's plugin sync does.
    await cp(
      path.join(path.dirname(options.ownedConfigDir), "Citizens"),
      path.join(pluginsDir, "Citizens"),
      { recursive: true },
    );
  }
  if (options.fixturesJar !== undefined) {
    await Bun.write(
      path.join(pluginsDir, "TheStormFixtures.jar"),
      Bun.file(options.fixturesJar),
    );
  }
  if (options.companionsE2eJar !== undefined) {
    await stageCompanionsE2e(pluginsDir, options.companionsE2eJar);
  }
  await Bun.write(
    path.join(pluginsDir, "TheStorm", "config.yml"),
    options.stormConfig,
  );
  if (options.rwf !== undefined) {
    await overlayRwf(path.join(pluginsDir, "TheStorm", "rwf.yml"), options.rwf);
  }
  if (
    options.mechanicsE2eJar !== undefined ||
    options.mechanicsConfig !== undefined
  ) {
    if (
      options.mechanicsE2eJar === undefined ||
      options.mechanicsConfig === undefined
    ) {
      throw new Error("mechanics E2E jar and config must be provided together");
    }
    await Bun.write(
      path.join(pluginsDir, "TheStormMechanicsE2E.jar"),
      Bun.file(options.mechanicsE2eJar),
    );
    await Bun.write(
      path.join(pluginsDir, "TheStormMechanicsE2E", "mechanics.yml"),
      options.mechanicsConfig,
    );
  }
  if (
    options.brain !== undefined ||
    options.sweep !== undefined ||
    options.agent !== undefined
  ) {
    if (
      options.brain === undefined ||
      options.sweep === undefined ||
      options.agent === undefined
    ) {
      throw new Error(
        "brain, sweep, and agent overrides must be provided together",
      );
    }
    const stagedAgentYml = path.join(pluginsDir, "TheStorm", "agent.yml");
    await overlayBrainUrl(stagedAgentYml, options.brain.baseUrl);
    await overlaySweep(stagedAgentYml, options.sweep);
    await overlayAgentTopLevel(stagedAgentYml, options.agent);
  }
  if (options.warmCache) {
    const cachedLibs = path.join(cacheDir, luckPermsLibs);
    await mkdir(cachedLibs, { recursive: true });
    await cp(cachedLibs, path.join(pluginsDir, luckPermsLibs), {
      recursive: true,
    });
  }
  return pluginsDir;
}

// Warm-cache mounts, host dir under the cache -> container path, for
// Paperclip's patched Mojang jar and libraries.
const warmMounts = [
  ["paperclip/cache", "/data/cache"],
  ["paperclip/libraries", "/data/libraries"],
  ["paperclip/versions", "/data/versions"],
] as const;

// LuckPerms downloads its libraries (including the H2 driver) from Maven
// Central on first enable. They cannot be bind-mounted: Docker would create
// /data/plugins as root and the image's unprivileged plugin sync would fail.
// Instead they ride in through /plugins and are copied back out after boot.
const luckPermsLibs = path.join("LuckPerms", "libs");

function serverEnv(
  rconPassword: string,
  brainToken: string,
  extra: Record<string, string>,
  heap: string,
): Record<string, string> {
  return {
    EULA: "TRUE",
    TYPE: "PAPER",
    VERSION: paper.version,
    PAPER_BUILD: paper.build.toString(),
    ONLINE_MODE: "FALSE",
    ENABLE_RCON: "true",
    RCON_PASSWORD: rconPassword,
    STORM_BRAIN_BEARER_TOKEN: brainToken,
    ...extra,
    // Keep boot hermetic: do not fetch third-party default configs.
    SKIP_DOWNLOAD_DEFAULTS: "true",
    MEMORY: heap,
    LEVEL_TYPE: "minecraft:flat",
    GENERATE_STRUCTURES: "false",
    SPAWN_PROTECTION: "0",
    DIFFICULTY: "peaceful",
    MODE: "survival",
    VIEW_DISTANCE: "4",
    SIMULATION_DISTANCE: "4",
    ENABLE_AUTOPAUSE: "false",
  };
}

async function bootContainer(
  id: string,
  rconPassword: string,
  deadline: number,
): Promise<Omit<ServerInfo & { kind: "container" }, "bootMs">> {
  await docker(["start", id]);
  await waitForLog(id, /Done \(\d+\.\d+s\)! For help/u, deadline);
  const { stdout: logs } = await docker(["logs", id]);
  if (
    logs.includes("The Storm failed to enable") ||
    logs.includes("Error occurred while enabling")
  ) {
    throw new Error(`Server plugin startup failed:\n${logs.slice(-12_000)}`);
  }
  const game = await publishedPort(id, 25_565);
  const rcon = await publishedPort(id, 25_575);
  // The Done line proves the game port; prove RCON accepts and executes a
  // command too before handing the server to the E2E suite.
  const client = await RconClient.connect({
    host: rcon.host,
    port: rcon.port,
    password: rconPassword,
  });
  await client.command("list");
  client.close();
  return {
    kind: "container",
    containerId: id,
    host: game.host,
    gamePort: game.port,
    rconPort: rcon.port,
    rconPassword,
  };
}

export async function startServer(
  options: StartServerOptions,
): Promise<StartedServer> {
  const started = Date.now();
  const cacheDir = path.resolve(options.cacheDir);
  const runsDir = path.join(cacheDir, "runs");
  const stagingDir = path.join(runsDir, process.pid.toString());
  await mkdir(runsDir, { recursive: true });
  await reapOrphans(runsDir);
  await rm(stagingDir, { recursive: true, force: true });

  const paperJar = path.join(
    cacheDir,
    `paper-${paper.version}-${paper.build.toString()}.jar`,
  );
  const [pluginsDir] = await Promise.all([
    stagePlugins(cacheDir, stagingDir, options),
    ...(options.warmCache ? [ensureArtifact(paperJar, paper)] : []),
    ...(options.warmCache
      ? warmMounts.map(async ([dir]) =>
          mkdir(path.join(cacheDir, dir), { recursive: true }),
        )
      : []),
  ]);

  // Bukkit throttles reconnects from one address for 4s by default, which
  // breaks back-to-back bot joins from the test runner.
  const bukkitYml = path.join(stagingDir, "bukkit.yml");
  await Bun.write(bukkitYml, "settings:\n  connection-throttle: -1\n");
  await chmod(bukkitYml, 0o666);

  const rconPassword = randomBytes(24).toString("hex");
  const { stdout: containerId } = await docker([
    "create",
    "--label",
    ownerLabel,
    "--label",
    `${pidLabel}=${process.pid.toString()}`,
    "-p",
    `127.0.0.1:${options.gamePort?.toString() ?? ""}:25565`,
    "-p",
    "127.0.0.1::25575",
    "-v",
    `${pluginsDir}:/plugins:ro`,
    ...(options.warmCache
      ? warmMounts.flatMap(([dir, target]) => [
          "-v",
          `${path.join(cacheDir, dir)}:${target}`,
        ])
      : []),
    ...(options.resources === undefined
      ? []
      : [
          `--cpus=${options.resources.cpus.toString()}`,
          `--memory=${options.resources.memoryLimit}`,
        ]),
    ...Object.entries(
      serverEnv(
        rconPassword,
        options.brain.token,
        options.env,
        options.resources?.heap ?? "1G",
      ),
    ).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
    serverImage,
  ]);
  const id = containerId.trim();
  const stop = async () => {
    await docker(["rm", "-f", "-v", id]);
    await rm(stagingDir, { recursive: true, force: true });
  };
  try {
    await docker(["cp", bukkitYml, `${id}:/data/bukkit.yml`]);
    if (options.warmCache) {
      await docker(["cp", paperJar, `${id}:/data/${path.basename(paperJar)}`]);
    }
    const connection = await bootContainer(
      id,
      rconPassword,
      started + options.bootTimeoutMs,
    );
    if (options.warmCache) {
      await docker([
        "cp",
        `${id}:/data/plugins/${luckPermsLibs}/.`,
        path.join(cacheDir, luckPermsLibs),
      ]);
    }
    const info = ServerInfoSchema.parse({
      ...connection,
      bootMs: Date.now() - started,
    });
    return { info, stop };
  } catch (error) {
    const { stdout, stderr } = await docker(["logs", id]);
    await Bun.write(
      path.join(cacheDir, "latest-server.log"),
      `${stdout}\n${stderr}`,
    );
    await stop();
    throw error;
  }
}

/** The server's console log so far, from Docker or the shared sidecar log file. */
export async function serverLogs(info: ServerInfo): Promise<string> {
  switch (info.kind) {
    case "container": {
      const { stdout } = await docker(["logs", info.containerId]);
      return stdout;
    }
    case "external": {
      return Bun.file(info.logFile).text();
    }
  }
}
