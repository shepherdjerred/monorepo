/**
 * NPM publish step generators.
 */
import { NPM_PACKAGES } from "../catalog.ts";
import { safeKey, RETRY, DAGGER_ENV } from "../lib/buildkite.ts";
import { k8sPlugin } from "../lib/k8s-plugin.ts";
import type { BuildkiteGroup, BuildkiteStep } from "../lib/types.ts";
import { WORKSPACE_DEPS } from "../../../../.dagger/src/deps.ts";

const MAIN_ONLY = "build.branch == pipeline.default_branch";

function npmPublishStep(pkg: { name: string; dir: string }): BuildkiteStep {
  const deps = WORKSPACE_DEPS[pkg.name] ?? [];
  const depFlags = deps
    .flatMap((d: string) => [`--dep-names ${d}`, `--dep-dirs ./packages/${d}`])
    .join(" ");
  const cmd = [
    `dagger call publish-npm --pkg-dir ./${pkg.dir} --pkg ${pkg.name}`,
    depFlags,
    `--npm-token env:NPM_TOKEN`,
  ]
    .filter(Boolean)
    .join(" ");
  return {
    label: `:npm: Publish ${pkg.name}`,
    key: `npm-${safeKey(pkg.name)}`,
    if: MAIN_ONLY,
    depends_on: "release",
    command: cmd,
    timeout_in_minutes: 10,
    retry: RETRY,
    env: DAGGER_ENV,
    plugins: [k8sPlugin({ cpu: "500m", memory: "512Mi" })],
  };
}

export function publishNpmGroup(): BuildkiteGroup {
  return {
    group: ":npm: Publish NPM",
    key: "publish-npm",
    steps: NPM_PACKAGES.map(npmPublishStep),
  };
}
