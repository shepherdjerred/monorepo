import { randomBytes } from "node:crypto";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { docker } from "@shepherdjerred/mc-harness/providers/docker/docker-cli.ts";
import {
  basePaperEnv,
  ensureArtifact,
  envArgs,
  paperJarName,
  publishedPort,
  reapPidOwnedContainers,
  startAndAwaitDone,
  warmMountArgs,
  warmMounts,
  writeThrottleFreeBukkitYml,
} from "@shepherdjerred/mc-harness/providers/docker/paper-container.ts";
import { paper, serverImage } from "@shepherdjerred/mc-harness/pins.ts";
import {
  overlayAgentTopLevel,
  overlayBrainUrl,
  overlaySweep,
} from "./config-overlays.ts";
import { thirdPartyPlugins } from "./pins.ts";
import { RconClient } from "@shepherdjerred/the-storm-brain/rcon";

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
  /** Contents of plugins/TheStorm/config.yml. */
  stormConfig: string;
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
};

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
  }
  if (options.fixturesJar !== undefined) {
    await Bun.write(
      path.join(pluginsDir, "TheStormFixtures.jar"),
      Bun.file(options.fixturesJar),
    );
  }
  await Bun.write(
    path.join(pluginsDir, "TheStorm", "config.yml"),
    options.stormConfig,
  );
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
  full: boolean,
  brainUrl: string,
): Record<string, string> {
  return {
    ...basePaperEnv(),
    ENABLE_RCON: "true",
    RCON_PASSWORD: rconPassword,
    STORM_BRAIN_BEARER_TOKEN: brainToken,
    // Deliberately malformed test token: JDA rejects it locally, without
    // authenticating to or posting in a real Discord server.
    ...(full
      ? {
          DISCORD_BOT_TOKEN: "invalid-storm-fixture-token",
          DISCORD_CHANNEL_ID: "1",
          FLIPT_URL: brainUrl,
          FLIPT_ENVIRONMENT: "prod",
        }
      : {}),
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
    "127.0.0.1::25565",
    "-p",
    "127.0.0.1::25575",
    "-v",
    `${pluginsDir}:/plugins:ro`,
    ...(options.warmCache ? warmMountArgs(cacheDir) : []),
    ...envArgs(
      serverEnv(
        rconPassword,
        options.brain.token,
        options.fixturesJar !== undefined,
        options.brain.baseUrl,
      ),
    ),
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
