import type { CiImages } from "#src/images.ts";
import type { CiStep } from "#src/pipeline/model.ts";
import { MEDIUM_TIER } from "#src/pipeline/tiers.ts";
import { GLOBAL_SELECTOR_INPUTS } from "#src/pipeline/inputs.ts";
import { GITHUB_DOWNLOAD } from "#src/pipeline/lanes/tofu.ts";

const PAPER_SERVER_IMAGE =
  "itzg/minecraft-server:2026.9.1-java25@sha256:e8640538dac5d54c2838d57fa9641e735ad0cf2b71fb0e8a68da3b542a315749";
const PAPER_WORKSPACE =
  "/woodpecker/src/github.com/shepherdjerred/monorepo/packages/the-storm/.cache/e2e/woodpecker";
const PLUGIN_DIR = `${PAPER_WORKSPACE}/plugins`;
const DATA_DIR = `${PAPER_WORKSPACE}/data`;
const RCON_PASSWORD = "storm-e2e-ci-rcon-password";

const PAPER_SERVICE_TIER = {
  cpuRequest: "2",
  cpuLimit: "4",
  memoryRequest: "4Gi",
  memoryLimit: "8Gi",
  ephemeralStorageRequest: "2Gi",
  ephemeralStorageLimit: "12Gi",
} as const;

/** Real-server Paper E2E for The Storm, with Paper on a workspace-sharing service pod. */
export function stormE2eSteps(images: CiImages): CiStep[] {
  return [
    {
      key: "paper-e2e-pr",
      label: "Paper 26.2 + The Storm e2e",
      image: images.base,
      commands: [
        ". ci/scripts/toolchain.sh",
        "ci/scripts/bun-install.sh --frozen-lockfile --filter '@shepherdjerred/the-storm'",
        "bun --no-install run --cwd packages/the-storm build",
        "bun --no-install packages/the-storm/tests/e2e/prepare-sidecar.ts",
        "bun --no-install run --cwd packages/the-storm test:e2e",
      ],
      environment: {
        STORM_E2E_HOST: "paper",
        STORM_E2E_GAME_PORT: "25565",
        STORM_E2E_RCON_HOST: "paper",
        STORM_E2E_RCON_PORT: "25575",
        STORM_E2E_RCON_PASSWORD: RCON_PASSWORD,
        STORM_E2E_LOG_FILE: `${DATA_DIR}/logs/latest.log`,
        STORM_E2E_PLUGIN_DIR: PLUGIN_DIR,
        STORM_E2E_DATA_DIR: DATA_DIR,
      },
      timeoutMinutes: 45,
      resources: MEDIUM_TIER,
      secrets: [GITHUB_DOWNLOAD],
      services: [
        {
          name: "paper",
          image: PAPER_SERVER_IMAGE,
          commands: [
            `until test -f ${PLUGIN_DIR}/.ready; do sleep 1; done; exec /start`,
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
          },
          resources: PAPER_SERVICE_TIER,
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
          "packages/eslint-config/**",
        ],
      },
      events: ["pull_request"],
    },
  ];
}
