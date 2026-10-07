import { randomBytes } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { stormModuleConfig } from "@shepherdjerred/mc-harness/sandbox/storm.ts";
import { paper, serverImage } from "@shepherdjerred/mc-harness/pins.ts";
import { thirdPartyPlugins } from "#e2e/harness/pins.ts";
import { startFakeBrain } from "#e2e/harness/fake-brain.ts";
import { startServer } from "#e2e/harness/server.ts";
import { RconClient } from "#e2e/harness/rcon.ts";
import {
  rwfTestSettings,
  rwfRecordingSalt,
} from "#e2e/harness/rwf-settings.ts";
import { DuelClient } from "./duels.ts";
import { InferenceClient } from "./inference.ts";
import { InferenceLoadClient } from "./load-client.ts";
import { gameplayFixtures } from "#e2e/gameplay-fixtures.ts";
import {
  docker,
  serverLogs,
} from "@shepherdjerred/mc-harness/providers/docker/docker-cli.ts";
import { openNativeObserver } from "#learning/native/observer.ts";

export const root = path.resolve(import.meta.dirname, "../..");
const content = path.join(root, "server/owned/plugins/TheStorm");
const stormJar = path.join(root, "plugin/dist/build/libs/TheStorm.jar");
const fixturesJar = path.join(
  root,
  "plugin/dist/build/libs/TheStormFixtures.jar",
);

export async function frozenManifest() {
  const learning = path.join(root, "tools/learning");
  const [listing, preference, promotion, native, personalities] =
    await Promise.all([
      readdir(learning),
      readdir(path.join(learning, "preference")),
      readdir(path.join(learning, "promotion")),
      readdir(path.join(learning, "native"), { recursive: true }),
      readdir(path.join(content, "rwfbots/personalities")),
    ]);
  const sources = [
    ...listing,
    ...preference.map((file) => `preference/${file}`),
    ...promotion.map((file) => `promotion/${file}`),
    ...native.map((file) => `native/${file}`),
  ]
    .filter((file) => /\.(?:py|ts|toml|lock|json)$/u.test(file))
    .sort();
  const files = [
    stormJar,
    fixturesJar,
    ...["bot.ts", "rcon.ts", "pins.ts", "rwf-trails.ts"].map((file) =>
      path.join(root, "tests/e2e/harness", file),
    ),
    path.join(root, "scripts/bots/learning/dataset.py"),
    path.join(root, "scripts/bots/learning/preference_recording.py"),
    path.join(content, "rwf.yml"),
    path.join(content, "rwfbots.yml"),
    ...personalities
      .filter((file) => file.endsWith(".yml"))
      .sort()
      .map((file) => path.join(content, "rwfbots/personalities", file)),
    path.join(content, "rwf/kits.yml"),
    path.join(content, "rwf/maps/training-yard/map.yml"),
    path.join(content, "rwf/maps/training-yard/blocks.schem"),
    path.join(content, "rwf/maps/training-yard/nav.rwfnav"),
    path.join(
      root,
      "plugin/modules/rwfbots/src/main/resources/rwf-combat-v1.tsv",
    ),
    path.join(root, "plugin/modules/rwfbots/src/main/resources/rwf-duel.json"),
    path.join(
      root,
      "plugin/modules/rwfbots/src/main/resources/rwf-duel-setup.json",
    ),
    path.join(
      root,
      "plugin/modules/rwfbots/src/main/resources/rwf-actor-parity.json",
    ),
    path.join(
      root,
      "plugin/modules/rwfbots/src/main/resources/rwf-actor-promotion.json",
    ),
    path.join(
      root,
      "plugin/modules/rwfbots/src/main/resources/rwf-inference-load.json",
    ),
    path.join(
      root,
      "plugin/modules/rwfbots/src/main/resources/rwf-regression-capture.json",
    ),
    ...sources.map((file) => path.join(learning, file)),
  ];
  const hashes = await Promise.all(
    files.map(async (file) => ({
      file: path.relative(root, file),
      sha256: new Bun.CryptoHasher("sha256")
        .update(await Bun.file(file).arrayBuffer())
        .digest("hex"),
    })),
  );
  return {
    hashes,
    engine: "Paper",
    controllerHz: 20,
    timeoutTicks: 1200,
    runtime: {
      serverImage,
      paper: {
        version: paper.version,
        build: paper.build,
        sha256: paper.sha256,
      },
      plugins: thirdPartyPlugins.map(({ name, version, sha256 }) => ({
        name,
        version,
        sha256,
      })),
    },
  };
}

export async function openPaperDuels(
  output: string,
  learningModelDir?: string,
  profile: "duel" | "load" | "regression" | "regression-player" = "duel",
) {
  const token = randomBytes(24).toString("hex");
  const brain = startFakeBrain(token);
  const brainUrl = `http://host.docker.internal:${brain.port.toString()}`;
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  let rcon: RconClient | undefined;
  let observer: Awaited<ReturnType<typeof openNativeObserver>> | undefined;
  let observerStarted = false;
  const stop = async () => {
    const failures: unknown[] = [];
    const steps = [
      async () => observer?.stop(),
      async () => {
        if (
          server !== undefined &&
          (observerStarted || profile.startsWith("regression"))
        )
          await Bun.write(
            path.join(output, "server.log"),
            await serverLogs(server.info),
          );
      },
      async () => {
        rcon?.close();
        await server?.stop();
      },
      async () => brain.stop(),
    ];
    for (const close of steps) {
      try {
        await close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(failures, "Paper duel owner cleanup failed");
  };
  try {
    server = await startServer({
      cacheDir: path.join(root, ".cache/e2e/learning"),
      bootTimeoutMs: 180_000,
      warmCache: true,
      stormJar,
      fixturesJar,
      ...(learningModelDir === undefined ? {} : { learningModelDir }),
      ownedConfigDir: content,
      stormConfig: stormModuleConfig(
        await Bun.file(path.join(content, "config.yml")).text(),
        ["economy", "mail", "tracks", "rwf", "rwfbots"],
      ),
      rwf: {
        ...rwfTestSettings,
        countdown: profile === "regression-player" ? "PT5S" : "PT1S",
        endLinger: "PT1S",
        targetCombatants: profile.startsWith("regression") ? 8 : 2,
        maxCombatants: profile.startsWith("regression") ? 16 : 2,
      },
      exportRecordingsDir: path.join(output, "recordings"),
      sweep: {
        intervalMinutes: 1,
        redriveAfterMinutes: 0,
        redriveBackoffMinutes: 0,
        slaAfterMinutes: 10_080,
      },
      agent: {
        mode: profile === "load" ? "active" : "shadow",
        reviewSamplePercent: 100,
      },
      brain: { baseUrl: brainUrl, token },
      env: {
        FLIPT_URL: brainUrl,
        FLIPT_ENVIRONMENT: "prod",
        RWF_RECORDING_SALT: rwfRecordingSalt,
        ...(profile === "load"
          ? {
              // Same locally rejected placeholders as the full E2E suite.
              DISCORD_BOT_TOKEN: "invalid-storm-fixture-token",
              DISCORD_CHANNEL_ID: "1",
            }
          : {}),
      },
      ...(profile === "load"
        ? {
            ...(await gameplayFixtures(root, "load")),
            resources: { cpus: 4, heap: "8G", memoryLimit: "10g" },
          }
        : {}),
    });
    if (profile === "load") {
      if (server.info.kind !== "container")
        throw new Error("load profile requires Docker resource limits");
      const limits = await docker([
        "inspect",
        "--format",
        "{{.HostConfig.NanoCpus}} {{.HostConfig.Memory}}",
        server.info.containerId,
      ]);
      const heap = await docker([
        "inspect",
        "--format",
        '{{range .Config.Env}}{{if eq . "MEMORY=8G"}}{{.}}{{end}}{{end}}',
        server.info.containerId,
      ]);
      if (
        limits.stdout.trim() !== "4000000000 10737418240" ||
        heap.stdout.trim() !== "MEMORY=8G"
      )
        throw new Error(
          "native inference load resources differ from the frozen plan",
        );
    }
    rcon = await RconClient.connect({
      host: server.info.host,
      port: server.info.rconPort,
      password: server.info.rconPassword,
    });
    const observerConsole = rcon;
    const address = `127.0.0.1:${server.info.gamePort.toString()}`;
    return {
      console: rcon,
      playerAddress: { host: server.info.host, port: server.info.gamePort },
      duels: new DuelClient(rcon),
      inference: new InferenceClient(rcon),
      load: new InferenceLoadClient(rcon),
      async openObserver() {
        if (profile !== "duel")
          throw new Error("Native capture requires the duel profile");
        if (observerStarted)
          throw new Error(
            "This Paper owner already started its native observer",
          );
        observerStarted = true;
        observer = await openNativeObserver({
          output: path.join(output, "client"),
          packageRoot: root,
          server: address,
          rcon: observerConsole,
        });
        return observer;
      },
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
