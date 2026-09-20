import type { CiImages } from "#src/images.ts";
import type { CiStep } from "#src/pipeline/model.ts";
import { MEDIUM_TIER } from "#src/pipeline/tiers.ts";
import { GLOBAL_SELECTOR_INPUTS } from "#src/pipeline/inputs.ts";
import { GITHUB_DOWNLOAD } from "#src/pipeline/lanes/tofu.ts";

/**
 * llm-observability end-to-end suite, against real Tempo and MinIO.
 *
 * Buildkite ran these as extra containers in the step's pod, with Tempo's
 * config coming from a GitOps-reconciled ConfigMap that an init container
 * rewrote with yq at start-up. That rewrite existed only because the live
 * ConfigMap lagged any PR that changed the Tempo version.
 *
 * Woodpecker services share the step's workspace, so the config is simply a
 * file in the repository next to the suite that uses it. The ConfigMap, the
 * yq init container, and the version-lag problem all go away together.
 *
 * The bucket creation that was a second init container moves into the step,
 * which has to wait for MinIO to accept connections anyway.
 */

const TEMPO_CONFIG = "packages/llm-observability/test/tempo.yaml";
const MINIO_ROOT = "minioadmin";
const ARCHIVE_BUCKET = "llm-archive";

export function observabilityE2eSteps(images: CiImages): CiStep[] {
  return [
    {
      key: "docker-e2e",
      label: "llm-observability e2e",
      image: images.base,
      commands: [
        ". ci/scripts/toolchain.sh",
        "ci/scripts/bun-install.sh --frozen-lockfile --filter '@shepherdjerred/llm-observability'",
        // Services start with the step, not before it, so wait rather than
        // assume. `mc alias set` is the readiness probe MinIO actually has.
        `until mc alias set local http://127.0.0.1:9000 ${MINIO_ROOT} ${MINIO_ROOT}; do sleep 1; done`,
        `mc mb --ignore-existing local/${ARCHIVE_BUCKET}`,
        "bun --no-install run --cwd packages/llm-observability test:e2e:ci",
      ],
      timeoutMinutes: 30,
      resources: MEDIUM_TIER,
      secrets: [GITHUB_DOWNLOAD],
      services: [
        {
          name: "tempo",
          image: images.catalog["grafana/tempo"],
          commands: [`/tempo -config.file=$CI_WORKSPACE/${TEMPO_CONFIG}`],
        },
        {
          name: "minio",
          image: images.catalog["minio/minio"],
          commands: ["minio server /data --console-address :9001"],
          environment: {
            MINIO_ROOT_USER: MINIO_ROOT,
            MINIO_ROOT_PASSWORD: MINIO_ROOT,
          },
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
