/**
 * Cooklang release step generator.
 *
 * One Dagger call (`cooklang-build-and-publish`) does the whole thing:
 * build → publish to shepherdjerred/cooklang-for-obsidian (computes next
 * patch version, updates manifest + versions.json, commits, creates the
 * GitHub release) → open auto-merge commit-back PR on the monorepo.
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
        label: ":cook: Publish cooklang plugin",
        key: "cooklang-publish",
        if: MAIN_ONLY,
        depends_on: dependsOn,
        command: `dagger call cooklang-build-and-publish ${COOKLANG_PKG_FLAGS} --gh-token env:GH_TOKEN${DRYRUN_FLAG}`,
        timeout_in_minutes: 15,
        priority: 1,
        retry: RETRY,
        env: DAGGER_ENV,
        plugins: [k8sPlugin({ cpu: "250m", memory: "512Mi" })],
      },
    ],
  };
}
