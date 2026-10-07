import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { RconClient } from "#e2e/harness/rcon.ts";
import { startFakeBrain } from "#e2e/harness/fake-brain.ts";
import { serverLogs } from "@shepherdjerred/mc-harness/providers/docker/docker-cli.ts";
import { startServer } from "#e2e/harness/server.ts";
import { stormModuleConfig } from "@shepherdjerred/mc-harness/sandbox/storm.ts";
import { gameplayFixtures } from "#e2e/gameplay-fixtures.ts";
import {
  rwfRecordingSalt,
  rwfTestSettings,
} from "#e2e/harness/rwf-settings.ts";
import { startControl, ViewpointsSchema } from "./control.ts";
import { request, StatusSchema, waitFor, type Session } from "./protocol.ts";
import { smoke, tour } from "./scripts.ts";
import { verifyDuelClock } from "./verify-duel-clock.ts";
import { verifyDuelVideo } from "./verify-duel-video.ts";
import { startClient } from "./process.ts";

const packageRoot = path.resolve(import.meta.dirname, "../..");

async function build(directory: string, tasks: string[]): Promise<void> {
  const child = Bun.spawn(
    [
      "mise",
      "exec",
      "--",
      "gradle",
      "-p",
      directory,
      ...tasks,
      "--console=plain",
    ],
    {
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  if ((await child.exited) !== 0) throw new Error(`Build failed: ${directory}`);
}

type PreviewOptions = {
  world?: string;
  vanilla: boolean;
  verify: boolean;
  rwfDuel: boolean;
  verifyDuelClock: boolean;
  verifyDuelVideo: boolean;
};

function validateOptions(options: PreviewOptions): void {
  if (options.vanilla && options.rwfDuel)
    throw new Error("--rwf-duel requires Storm modules");
  if (options.verifyDuelClock && (!options.rwfDuel || options.verify))
    throw new Error(
      "--verify-duel-clock requires --rwf-duel and its own verification run",
    );
  if (
    options.verifyDuelVideo &&
    (!options.rwfDuel || options.verify || options.verifyDuelClock)
  )
    throw new Error(
      "--verify-duel-video requires --rwf-duel and its own verification run",
    );
}

export async function preview(options: PreviewOptions): Promise<void> {
  validateOptions(options);
  await build(path.join(packageRoot, "client"), ["assemble"]);
  await build(
    path.join(packageRoot, "plugin"),
    options.vanilla
      ? [":dist:shadowJar"]
      : [":dist:shadowJar", ":dist:fixturesJar", ":companions:e2eJar"],
  );
  const privateDir = await mkdtemp(path.join(os.tmpdir(), "storm-client-"));
  await chmod(privateDir, 0o700);
  const artifacts = path.join(
    packageRoot,
    ".cache/client",
    path.basename(privateDir),
  );
  await mkdir(artifacts, { recursive: true });
  const cleanup: (() => Promise<void>)[] = [
    async () => rm(privateDir, { recursive: true, force: true }),
  ];
  const { promise: stopped, resolve } = Promise.withResolvers<undefined>();
  const finish = () => {
    resolve(undefined);
  };
  process.once("SIGINT", finish);
  process.once("SIGTERM", finish);
  let failure: Error | undefined;
  try {
    await run(options, { privateDir, artifacts, cleanup, stopped, finish });
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
  } finally {
    process.removeListener("SIGINT", finish);
    process.removeListener("SIGTERM", finish);
    const failures: unknown[] = [];
    for (const close of cleanup.toReversed()) {
      try {
        await close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      failure = new AggregateError(
        failure === undefined ? failures : [failure, ...failures],
        "Preview cleanup failed",
      );
  }
  if (failure !== undefined) throw failure;
}

type Run = {
  privateDir: string;
  artifacts: string;
  cleanup: (() => Promise<void>)[];
  stopped: Promise<void>;
  finish: () => void;
};

async function run(
  options: {
    world?: string;
    vanilla: boolean;
    verify: boolean;
    rwfDuel: boolean;
    verifyDuelClock: boolean;
    verifyDuelVideo: boolean;
  },
  runState: Run,
): Promise<void> {
  const brainToken = randomBytes(24).toString("hex");
  const brain = startFakeBrain(brainToken);
  runState.cleanup.push(async () => {
    await brain.stop();
  });
  const ownedConfigDir = path.join(
    packageRoot,
    "server/owned/plugins/TheStorm",
  );
  const configs = options.vanilla
    ? {
        stormConfig: stormModuleConfig(
          await Bun.file(path.join(ownedConfigDir, "config.yml")).text(),
          [],
        ),
      }
    : await gameplayFixtures(packageRoot, "full");
  const server = await startServer({
    cacheDir: path.join(packageRoot, ".cache/client/server"),
    bootTimeoutMs: 180_000,
    warmCache: true,
    stormJar: path.join(packageRoot, "plugin/dist/build/libs/TheStorm.jar"),
    ...configs,
    ...(options.rwfDuel
      ? {
          rwf: { ...rwfTestSettings, targetCombatants: 2, maxCombatants: 2 },
          rwfbotsConfig: await duelBotsConfig(ownedConfigDir),
        }
      : {}),
    ...(options.vanilla
      ? {}
      : { exportRecordingsDir: path.join(runState.artifacts, "recordings") }),
    ownedConfigDir,
    env: {
      FLIPT_URL: `http://host.docker.internal:${brain.port.toString()}`,
      FLIPT_ENVIRONMENT: "prod",
      RWF_RECORDING_SALT: rwfRecordingSalt,
      DISCORD_BOT_TOKEN: "invalid-storm-fixture-token",
      DISCORD_CHANNEL_ID: "1",
    },
    brain: {
      baseUrl: `http://host.docker.internal:${brain.port.toString()}`,
      token: brainToken,
    },
    sweep: {
      intervalMinutes: 1,
      redriveAfterMinutes: 0,
      redriveBackoffMinutes: 0,
      slaAfterMinutes: 10_080,
    },
    agent: { mode: "shadow", reviewSamplePercent: 100 },
    ...(options.world === undefined
      ? {}
      : { worldDir: path.resolve(options.world) }),
  });
  runState.cleanup.push(async () => {
    try {
      await Bun.write(
        path.join(runState.artifacts, "server.log"),
        await serverLogs(server.info),
      );
    } finally {
      await server.stop();
    }
  });
  const rcon = await RconClient.connect({
    host: server.info.host,
    port: server.info.rconPort,
    password: server.info.rconPassword,
  });
  runState.cleanup.push(() => {
    rcon.close();
    return Promise.resolve();
  });
  const session: Session = {
    socket: path.join(runState.privateDir, "client.sock"),
    control: path.join(runState.privateDir, "control.sock"),
    artifacts: runState.artifacts,
    server: `127.0.0.1:${server.info.gamePort.toString()}`,
  };
  const views = ViewpointsSchema.parse(
    await Bun.file(path.join(import.meta.dirname, "viewpoints.json")).json(),
  );
  const control = await startControl({
    socket: session.control,
    rcon,
    views,
    stop: runState.finish,
  });
  runState.cleanup.push(control);
  const client = await startClient({
    session,
    privateDir: runState.privateDir,
    packageRoot,
    onExit: runState.finish,
  });
  runState.cleanup.push(client.stop);
  await rcon.command("op StormPreview");
  await rcon.command("gamemode creative StormPreview");
  await rcon.command("gamerule minecraft:advance_time false");
  await rcon.command("time set day");
  await rcon.command("weather clear");
  await request(session, "fixture", { name: "chest" });
  await request(session, "viewpoint", {
    name: options.vanilla ? "fixture" : "lobby",
  });
  await request(session, "close");
  await waitFor(
    "closed arrival screen",
    async () => StatusSchema.parse(await request(session, "status")),
    (state) => state.connected && state.screen === "",
  );
  await Bun.write(
    path.join(runState.artifacts, "session.json"),
    JSON.stringify(session, null, 2),
  );
  console.warn(
    `Preview ready. Session: ${path.join(runState.artifacts, "session.json")}`,
  );
  if (options.verify) {
    await smoke(session);
    if (!options.vanilla) await tour(session);
    runState.finish();
  }
  if (options.verifyDuelClock) {
    await verifyDuelClock(session, rcon);
    runState.finish();
  }
  if (options.verifyDuelVideo) {
    await verifyDuelVideo(session, rcon);
    runState.finish();
  }
  await runState.stopped;
}

async function duelBotsConfig(ownedConfigDir: string): Promise<string> {
  const schema = z.looseObject({
    draft: z.looseObject({ kits: z.array(z.string()).min(1) }),
  });
  const config = schema.parse(
    Bun.YAML.parse(
      await Bun.file(path.join(ownedConfigDir, "rwfbots.yml")).text(),
    ),
  );
  config.draft.kits = ["trooper"];
  return Bun.YAML.stringify(config);
}
