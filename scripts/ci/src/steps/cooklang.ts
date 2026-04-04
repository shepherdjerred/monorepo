/**
 * Cooklang release step generators.
 *
 * Uses combined Dagger functions (cooklang-build-and-push, cooklang-build-and-release)
 * that build + publish in a single call. Dagger caches the build output.
 * No Buildkite artifact transfer.
 */
import { RETRY, DAGGER_ENV, DRYRUN_FLAG } from "../lib/buildkite.ts";
import { k8sPlugin } from "../lib/k8s-plugin.ts";
import type { BuildkiteGroup } from "../lib/types.ts";

const MAIN_ONLY = "build.branch == pipeline.default_branch";

const COOKLANG_PKG_FLAGS =
  "--pkg-dir ./packages/cooklang-for-obsidian --dep-names eslint-config --dep-dirs ./packages/eslint-config --tsconfig ./tsconfig.base.json";

export function cooklangReleaseGroup(pkgKey?: string): BuildkiteGroup {
  const dependsOn = pkgKey ? ["quality-gate", pkgKey] : ["quality-gate"];
  return {
    group: ":cook: Cooklang Release",
    key: "cooklang-release",
    steps: [
      {
        label: ":cook: Push cooklang artifacts",
        key: "cooklang-push",
        if: MAIN_ONLY,
        depends_on: dependsOn,
        command: `dagger call cooklang-build-and-push ${COOKLANG_PKG_FLAGS} --version "2.0.0-$BUILDKITE_BUILD_NUMBER" --gh-token env:GH_TOKEN${DRYRUN_FLAG}`,
        timeout_in_minutes: 15,
        priority: 1,
        retry: RETRY,
        env: DAGGER_ENV,
        plugins: [k8sPlugin({ cpu: "250m", memory: "512Mi" })],
      },
      {
        label: ":cook: Create cooklang release",
        key: "cooklang-release-create",
        if: MAIN_ONLY,
        depends_on: dependsOn,
        command: `dagger call cooklang-build-and-release ${COOKLANG_PKG_FLAGS} --version "2.0.0-$BUILDKITE_BUILD_NUMBER" --gh-token env:GH_TOKEN${DRYRUN_FLAG}`,
        timeout_in_minutes: 15,
        priority: 1,
        retry: RETRY,
        env: DAGGER_ENV,
        plugins: [k8sPlugin({ cpu: "250m", memory: "512Mi" })],
      },
    ],
  };
}
