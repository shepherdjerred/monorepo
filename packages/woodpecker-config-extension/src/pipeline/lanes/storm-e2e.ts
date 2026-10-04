import type { CiImages } from "#src/images.ts";
import type { CiStep } from "#src/pipeline/model.ts";
import { MEDIUM_TIER, SERVICE_TIER } from "#src/pipeline/tiers.ts";
import { GLOBAL_SELECTOR_INPUTS } from "#src/pipeline/inputs.ts";
import { GITHUB_DOWNLOAD } from "#src/pipeline/lanes/tofu.ts";

const PAPER_SERVER_IMAGE =
  "itzg/minecraft-server:2026.9.1-java25@sha256:e8640538dac5d54c2838d57fa9641e735ad0cf2b71fb0e8a68da3b542a315749";
const PAPER_WORKSPACE =
  "/woodpecker/src/github.com/shepherdjerred/monorepo/packages/the-storm/.cache/e2e/woodpecker";
const RCON_PASSWORD = "storm-e2e-ci-rcon-password";
const BRAIN_HOST = "storm-brain";
const BRAIN_PORT = "18081";
const BRAIN_TOKEN = "storm-e2e-ci-brain-token";

const PAPER_SERVICE_TIER = {
  cpuRequest: "1",
  cpuLimit: "4",
  memoryRequest: "4Gi",
  memoryLimit: "8Gi",
  ephemeralStorageRequest: "2Gi",
  ephemeralStorageLimit: "12Gi",
} as const;

/** Real-server Paper E2E for The Storm, with Paper on a workspace-sharing service pod. */
export function stormE2eSteps(images: CiImages): CiStep[] {
  return [stormE2eStep(images, false), stormE2eStep(images, true)];
}

function stormE2eStep(images: CiImages, full: boolean): CiStep {
  const workspace = full ? `${PAPER_WORKSPACE}-full` : PAPER_WORKSPACE;
  const pluginDir = `${workspace}/plugins`;
  const dataDir = `${workspace}/data`;
  return {
    key: full ? "paper-full-e2e-pr" : "paper-e2e-pr",
    label: full
      ? "Paper 26.2 + all 21 Storm modules"
      : "Paper 26.2 + The Storm e2e",
    image: images.base,
    commands: [
      ". ci/scripts/toolchain.sh",
      "ci/scripts/bun-install.sh --frozen-lockfile --filter '@shepherdjerred/the-storm'",
      "bun --no-install run --cwd packages/the-storm build",
      "bun --no-install packages/the-storm/tests/e2e/prepare-sidecar.ts",
      `bun --no-install run --cwd packages/the-storm ${full ? "test:full" : "test:e2e"}`,
    ],
    environment: {
      STORM_E2E_HOST: "paper",
      STORM_E2E_GAME_PORT: "25565",
      STORM_E2E_RCON_HOST: "paper",
      STORM_E2E_RCON_PORT: "25575",
      STORM_E2E_RCON_PASSWORD: RCON_PASSWORD,
      STORM_E2E_LOG_FILE: `${dataDir}/logs/latest.log`,
      STORM_E2E_PLUGIN_DIR: pluginDir,
      STORM_E2E_DATA_DIR: dataDir,
      STORM_E2E_FULL: full ? "1" : "0",
      STORM_E2E_BRAIN_HOST: BRAIN_HOST,
      STORM_E2E_BRAIN_PORT: BRAIN_PORT,
      STORM_E2E_BRAIN_TOKEN: BRAIN_TOKEN,
    },
    timeoutMinutes: 45,
    resources: MEDIUM_TIER,
    secrets: [GITHUB_DOWNLOAD],
    services: [
      {
        name: "paper",
        image: PAPER_SERVER_IMAGE,
        commands: [
          `mkdir -p ${dataDir}/logs; rm -rf /data/logs; ln -s ${dataDir}/logs /data/logs; until test -f ${pluginDir}/.ready; do sleep 1; done; exec /start`,
        ],
        environment: {
          EULA: "TRUE",
          TYPE: "PAPER",
          VERSION: "26.2",
          PAPER_BUILD: "129",
          ONLINE_MODE: "FALSE",
          ENABLE_RCON: "true",
          RCON_PASSWORD,
          SKIP_DOWNLOAD_DEFAULTS: "true",
          MEMORY: "1G",
          LEVEL_TYPE: "minecraft:flat",
          GENERATE_STRUCTURES: "false",
          SPAWN_PROTECTION: "0",
          DIFFICULTY: "peaceful",
          MODE: "survival",
          VIEW_DISTANCE: "4",
          SIMULATION_DISTANCE: "4",
          ENABLE_AUTOPAUSE: "false",
          STORM_BRAIN_BEARER_TOKEN: BRAIN_TOKEN,
          COPY_PLUGINS_SRC: pluginDir,
          COPY_CONFIG_SRC: `${dataDir}/config`,
          COPY_CONFIG_DEST: "/data",
          ...(full
            ? {
                DISCORD_BOT_TOKEN: "invalid-storm-fixture-token",
                DISCORD_CHANNEL_ID: "1",
                FLIPT_URL: `http://${BRAIN_HOST}:${BRAIN_PORT}`,
                FLIPT_ENVIRONMENT: "prod",
              }
            : {}),
        },
        resources: PAPER_SERVICE_TIER,
      },
      {
        name: BRAIN_HOST,
        image: images.base,
        commands: [
          `until test -f ${workspace}/brain.start; do sleep 1; done; cd /woodpecker/src/github.com/shepherdjerred/monorepo; exec bun --no-install packages/the-storm/tests/e2e/harness/fake-brain.ts`,
        ],
        environment: {
          STORM_E2E_BRAIN_PORT: BRAIN_PORT,
          STORM_E2E_BRAIN_TOKEN: BRAIN_TOKEN,
        },
        resources: SERVICE_TIER,
      },
    ],
    changed: {
      include: [
        ...GLOBAL_SELECTOR_INPUTS,
        "bun.lock",
        "bunfig.toml",
        "package.json",
        ".mise.toml",
        "patches/**",
        "turbo.json",
        "ci/scripts/bun-install.sh",
        "ci/scripts/toolchain.sh",
        "ci/scripts/migration-core.ts",
        "ci/scripts/selectors/ci-changed.ts",
        "scripts/ci-test-manifest.json",
        "scripts/ci-test-manifest.schema.json",
        "packages/the-storm/**",
        "packages/mc-harness/**",
        "packages/eslint-config/**",
      ],
    },
    events: ["pull_request"],
  };
}
