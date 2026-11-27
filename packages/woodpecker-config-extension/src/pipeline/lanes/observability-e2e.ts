import type { CiImages } from "#src/images.ts";
import type { CiStep } from "#src/pipeline/model.ts";
import { MEDIUM_TIER, SERVICE_TIER } from "#src/pipeline/tiers.ts";
import { GLOBAL_SELECTOR_INPUTS } from "#src/pipeline/inputs.ts";
import { GITHUB_DOWNLOAD } from "#src/pipeline/lanes/tofu.ts";

/**
 * llm-observability end-to-end suite, against real Tempo and MinIO.
 *
 * Woodpecker services are separate pods that mount the step's workspace, so
 * the config is simply a file in the repository next to the suite that uses
 * it, and the suite reaches each service by its name as a hostname. The ConfigMap, the
 * yq init container, and the version-lag problem all go away together.
 *
 * The suite creates its bucket through its existing signed S3 helper after
 * MinIO becomes ready, avoiding a third pod or a client binary in ci-base.
 */

const TEMPO_CONFIG = "packages/llm-observability/test/tempo.yaml";
const MINIO_ROOT = "minioadmin";

export function observabilityE2eSteps(images: CiImages): CiStep[] {
  return [
    {
      key: "docker-e2e",
      label: "llm-observability e2e",
      image: images.base,
      commands: [
        ". ci/scripts/toolchain.sh",
        "ci/scripts/bun-install.sh --frozen-lockfile --filter '@shepherdjerred/llm-observability'",
        "bun --no-install run --cwd packages/llm-observability test:e2e:ci",
      ],
      timeoutMinutes: 30,
      // Tempo and MinIO hold admission quota while the step waits for its
      // own, so bound them across every agent, PR and main push. Measured
      // 2026-11-27 over 72 h (232 runs, run time p50 53 s, p90 173 s): at
      // most three held their services at once, and replaying those
      // arrivals at a cap of three delays 0.4% of runs past a minute.
      concurrency: { limit: 3, group: "docker-e2e" },
      resources: MEDIUM_TIER,
      secrets: [GITHUB_DOWNLOAD],
      services: [
        {
          name: "tempo",
          image: images.catalog["grafana/tempo"],
          // Tempo's image is distroless and has no /bin/sh for Woodpecker's
          // `commands` wrapper. Services share the checkout at this path.
          entrypoint: [
            "/tempo",
            `-config.file=/woodpecker/src/github.com/shepherdjerred/monorepo/${TEMPO_CONFIG}`,
          ],
          resources: SERVICE_TIER,
        },
        {
          name: "minio",
          image: images.catalog["pgsty/silo"],
          commands: ["silo server /data --console-address :9001"],
          environment: {
            MINIO_ROOT_USER: MINIO_ROOT,
            MINIO_ROOT_PASSWORD: MINIO_ROOT,
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
          "patches/**",
          "turbo.json",
          "packages/llm-observability/**",
          "packages/s3-signed-request/**",
          "packages/eslint-config/**",
        ],
      },
    },
  ];
}
