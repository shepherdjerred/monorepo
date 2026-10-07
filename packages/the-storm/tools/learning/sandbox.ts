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

export const root = path.resolve(import.meta.dirname, "../..");
const content = path.join(root, "server/owned/plugins/TheStorm");
const stormJar = path.join(root, "plugin/dist/build/libs/TheStorm.jar");
const fixturesJar = path.join(
  root,
  "plugin/dist/build/libs/TheStormFixtures.jar",
);

export async function frozenManifest() {
  const learning = path.join(root, "tools/learning");
  const listing = await readdir(learning);
  const sources = listing
    .filter((file) => /\.(?:py|ts|toml|lock|json)$/u.test(file))
    .sort();
  const files = [
    stormJar,
    fixturesJar,
    path.join(content, "rwf.yml"),
    path.join(content, "rwfbots.yml"),
    path.join(content, "rwf/kits.yml"),
    path.join(content, "rwf/maps/training-yard/map.yml"),
    path.join(content, "rwf/maps/training-yard/blocks.schem"),
    path.join(content, "rwf/maps/training-yard/nav.rwfnav"),
    path.join(
      root,
      "plugin/modules/rwfbots/src/main/resources/rwf-combat-v1.tsv",
    ),
    path.join(root, "plugin/modules/rwfbots/src/main/resources/rwf-duel.json"),
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
) {
  const token = randomBytes(24).toString("hex");
  const brain = startFakeBrain(token);
  const brainUrl = `http://host.docker.internal:${brain.port.toString()}`;
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  let rcon: RconClient | undefined;
  const stop = async () => {
    rcon?.close();
    try {
      await server?.stop();
    } finally {
      await brain.stop();
    }
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
        countdown: "PT1S",
        endLinger: "PT1S",
        targetCombatants: 2,
        maxCombatants: 2,
      },
      exportRecordingsDir: path.join(output, "recordings"),
      sweep: {
        intervalMinutes: 1,
        redriveAfterMinutes: 0,
        redriveBackoffMinutes: 0,
        slaAfterMinutes: 10_080,
      },
      agent: { mode: "shadow", reviewSamplePercent: 100 },
      brain: { baseUrl: brainUrl, token },
      env: {
        FLIPT_URL: brainUrl,
        FLIPT_ENVIRONMENT: "prod",
        RWF_RECORDING_SALT: rwfRecordingSalt,
      },
    });
    rcon = await RconClient.connect({
      host: server.info.host,
      port: server.info.rconPort,
      password: server.info.rconPassword,
    });
    return {
      duels: new DuelClient(rcon),
      inference: new InferenceClient(rcon),
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
