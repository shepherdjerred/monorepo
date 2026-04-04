/**
 * Cooklang release step generators.
 *
 * Build once, then push + release as separate steps reusing the build output.
 * The build step exports artifacts to a Buildkite artifact path; push and release
 * consume them. This avoids rebuilding cooklang 3 times.
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
        label: ":cook: Build cooklang",
        key: "cooklang-build",
        if: MAIN_ONLY,
        depends_on: dependsOn,
        command: [
          `dagger call cooklang-build ${COOKLANG_PKG_FLAGS} export --path tmp/cooklang-dist`,
          `buildkite-agent artifact upload "tmp/cooklang-dist/**/*"`,
        ].join(" && "),
        timeout_in_minutes: 15,
        priority: 1,
        retry: RETRY,
        env: DAGGER_ENV,
        plugins: [k8sPlugin({ cpu: "250m", memory: "512Mi" })],
      },
      {
        label: ":cook: Push cooklang artifacts",
        key: "cooklang-push",
        if: MAIN_ONLY,
        depends_on: ["cooklang-build", "extract-versions"],
        command: [
          `buildkite-agent artifact download "tmp/cooklang-dist/**/*" tmp/cooklang-dist`,
          `dagger call cooklang-push --source tmp/cooklang-dist --version "$(buildkite-agent meta-data get cooklang_version)" --gh-token env:GH_TOKEN${DRYRUN_FLAG}`,
        ].join(" && "),
        timeout_in_minutes: 10,
        priority: 1,
        retry: RETRY,
        env: DAGGER_ENV,
        plugins: [k8sPlugin({ cpu: "250m", memory: "512Mi" })],
      },
      {
        label: ":cook: Create cooklang release",
        key: "cooklang-release-create",
        if: MAIN_ONLY,
        depends_on: ["cooklang-build", "extract-versions"],
        command: [
          `buildkite-agent artifact download "tmp/cooklang-dist/**/*" tmp/cooklang-dist`,
          `dagger call cooklang-create-release --artifacts tmp/cooklang-dist --version "$(buildkite-agent meta-data get cooklang_version)" --gh-token env:GH_TOKEN${DRYRUN_FLAG}`,
        ].join(" && "),
        timeout_in_minutes: 10,
        priority: 1,
        retry: RETRY,
        env: DAGGER_ENV,
        plugins: [k8sPlugin({ cpu: "250m", memory: "512Mi" })],
      },
    ],
  };
}
