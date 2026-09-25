import type { CiImages } from "#src/images.ts";
import type { CiStep } from "#src/pipeline/model.ts";
import { MEDIUM_TIER } from "#src/pipeline/tiers.ts";
import { GLOBAL_SELECTOR_INPUTS } from "#src/pipeline/inputs.ts";

/**
 * Alert dashboard against a real SQLite file.
 *
 * The package's ordinary tests run in the `verify` graph; this lane exists to
 * exercise the Prisma migration path against an actual database file rather
 * than a mock, which is the only way a bad migration surfaces before deploy.
 */
export function alertDashboardSteps(images: CiImages): CiStep[] {
  return [
    {
      key: "alert-dashboard-sqlite",
      label: "alert dashboard (sqlite)",
      image: images.base,
      commands: [
        // Runtime scope: this lane needs the language runtimes, not the full
        // developer toolchain.
        "MISE_TOOLCHAIN_SCOPE=runtime . ci/scripts/toolchain.sh",
        "ci/scripts/bun-install.sh --frozen-lockfile --filter '@shepherdjerred/alert-dashboard'",
        "export DATABASE_URL='file:/tmp/alert-dashboard.db'",
        "bun --no-install run --cwd packages/alert-dashboard generate",
        "bun --no-install run --cwd packages/alert-dashboard migrate:deploy",
        "bun --no-install run --cwd packages/alert-dashboard test:sqlite",
      ],
      timeoutMinutes: 30,
      resources: MEDIUM_TIER,
      secrets: [
        {
          secret: "ci-github-credentials",
          key: "GITHUB_DOWNLOAD_TOKEN",
          env: "GITHUB_DOWNLOAD_TOKEN",
        },
      ],
      changed: {
        include: [
          ...GLOBAL_SELECTOR_INPUTS,
          "bun.lock",
          "bunfig.toml",
          "package.json",
          "packages/alert-dashboard/**",
          "packages/eslint-config/**",
          "packages/config/**",
          "packages/feature-flags/**",
          "packages/ops-model/**",
          "packages/ops-clients/**",
        ],
      },
    },
  ];
}
