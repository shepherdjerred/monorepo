import { randomBytes } from "node:crypto";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { docker } from "@shepherdjerred/mc-harness/providers/docker/docker-cli.ts";
import {
  ensureArtifact,
  paperJarName,
  stagePinnedPlugins,
  writeThrottleFreeBukkitYml,
} from "@shepherdjerred/mc-harness/sandbox/artifacts.ts";
import { basePaperEnv } from "@shepherdjerred/mc-harness/sandbox/paper-env.ts";
import {
  envArgs,
  publishedPort,
  reapPidOwnedContainers,
  startAndAwaitDone,
  warmMountArgs,
  warmMounts,
} from "@shepherdjerred/mc-harness/providers/docker/paper-container.ts";
import { paper, serverImage } from "@shepherdjerred/mc-harness/pins.ts";
import { stageCompanionsE2e } from "./companions-e2e.ts";
import {
  overlayAgentTopLevel,
  overlayBrainUrl,
  overlayRwf,
  overlaySweep,
  type RwfOverlay,
} from "./config-overlays.ts";
import { thirdPartyPlugins } from "./pins.ts";
import { RconClient } from "#e2e/harness/rcon.ts";
import { stageWorld } from "./world-copy.ts";

const ownerLabel = "the-storm.e2e";
const pidLabel = "the-storm.e2e.pid";

const ConnectionShape = {
  host: z.string().min(1),
  gamePort: z.number().int().positive(),
  rconPort: z.number().int().positive(),
  rconPassword: z.string().min(16),
};

// A run started by us in Docker, or a CI sidecar with a shared log file.
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
  survivalConfig?: string;
  /** Optional local world copy for terrain acceptance; copied into the disposable server. */
  worldDir?: string;
  /** Save the stopped world save, including its named dimensions, for inspection or provisioning. */
  exportWorldDir?: string;
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
    | "survivalConfig"
    | "worldDir"
    | "exportWorldDir"
    | "warmCache"
  > &
    Partial<
      Pick<StartServerOptions, "ownedConfigDir" | "brain" | "sweep" | "agent">
    >,
): Promise<string> {
  const pluginsDir = path.join(stagingDir, "plugins");
  await stagePinnedPlugins(
    path.join(cacheDir, "plugins"),
    pluginsDir,
    thirdPartyPlugins,
  );
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
  if (options.survivalConfig !== undefined) {
    await Bun.write(
      path.join(pluginsDir, "TheStorm", "arena", "survival.yml"),
      options.survivalConfig,
    );
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
    ...basePaperEnv(),
    ENABLE_RCON: "true",
    RCON_PASSWORD: rconPassword,
    STORM_BRAIN_BEARER_TOKEN: brainToken,
    ...extra,
    MEMORY: heap,
  };
}

async function bootContainer(
  id: string,
  rconPassword: string,
  deadline: number,
): Promise<Omit<ServerInfo & { kind: "container" }, "bootMs">> {
  await startAndAwaitDone(id, deadline, [
    "The Storm failed to enable",
    "Error occurred while enabling",
  ]);
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
  await reapPidOwnedContainers({ ownerLabel, pidLabel, runsDir });
  await rm(stagingDir, { recursive: true, force: true });

  const paperJar = path.join(cacheDir, paperJarName);
  const [pluginsDir] = await Promise.all([
    stagePlugins(cacheDir, stagingDir, options),
    ...(options.warmCache ? [ensureArtifact(paperJar, paper)] : []),
    ...(options.warmCache
      ? warmMounts.map(async ([dir]) =>
          mkdir(path.join(cacheDir, dir), { recursive: true }),
        )
      : []),
  ]);

  const bukkitYml = path.join(stagingDir, "bukkit.yml");
  await writeThrottleFreeBukkitYml(bukkitYml);

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
    ...(options.warmCache ? warmMountArgs(cacheDir) : []),
    ...(options.resources === undefined
      ? []
      : [
          `--cpus=${options.resources.cpus.toString()}`,
          `--memory=${options.resources.memoryLimit}`,
        ]),
    ...envArgs(
      serverEnv(
        rconPassword,
        options.brain.token,
        options.env,
        options.resources?.heap ?? "1G",
      ),
    ),
    serverImage,
  ]);
  const id = containerId.trim();
  const stop = async () => {
    if (options.exportWorldDir !== undefined) {
      await docker(["stop", "--time", "30", id]);
      await mkdir(options.exportWorldDir, { recursive: true });
      await docker(["cp", `${id}:/data/world/.`, options.exportWorldDir]);
    }
    await docker(["rm", "-f", "-v", id]);
    await rm(stagingDir, { recursive: true, force: true });
  };
  try {
    if (options.worldDir !== undefined) {
      await stageWorld(options.worldDir, stagingDir, id);
    }
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
