/**
 * Cooklang release step generators.
 */
import { RETRY, DAGGER_ENV, DRYRUN_FLAG } from "../lib/buildkite.ts";
import { k8sPlugin } from "../lib/k8s-plugin.ts";
import type { BuildkiteGroup } from "../lib/types.ts";

const MAIN_ONLY = "build.branch == pipeline.default_branch";

export function cooklangReleaseGroup(): BuildkiteGroup {
  return {
    group: ":cook: Cooklang Release",
    key: "cooklang-release",
    steps: [
      {
        label: ":cook: Build cooklang plugin",
        key: "cooklang-build",
        if: MAIN_ONLY,
        depends_on: "release",
        command:
          "dagger call cooklang-build --pkg-dir ./packages/cooklang-rich-preview",
        timeout_in_minutes: 10,
        retry: RETRY,
        env: DAGGER_ENV,
        plugins: [k8sPlugin({ cpu: "250m", memory: "512Mi" })],
      },
      {
        label: ":cook: Push cooklang to repo",
        key: "cooklang-push",
        if: MAIN_ONLY,
        depends_on: "cooklang-build",
        command: `dagger call cooklang-push --artifacts $(dagger call cooklang-build --pkg-dir ./packages/cooklang-rich-preview) --gh-token env:GH_TOKEN --repo shepherdjerred/cooklang-obsidian-releases${DRYRUN_FLAG}`,
        timeout_in_minutes: 10,
        retry: RETRY,
        env: DAGGER_ENV,
        plugins: [k8sPlugin({ cpu: "250m", memory: "512Mi" })],
      },
      {
        label: ":cook: Create cooklang release",
        key: "cooklang-release-create",
        if: MAIN_ONLY,
        depends_on: "cooklang-push",
        command: `dagger call cooklang-create-release --artifacts $(dagger call cooklang-build --pkg-dir ./packages/cooklang-rich-preview) --version "$(buildkite-agent meta-data get cooklang_version || echo dev)" --gh-token env:GH_TOKEN${DRYRUN_FLAG}`,
        timeout_in_minutes: 10,
        retry: RETRY,
        env: DAGGER_ENV,
        plugins: [k8sPlugin({ cpu: "250m", memory: "512Mi" })],
      },
    ],
  };
}
