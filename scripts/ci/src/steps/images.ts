/**
 * Image push step generators.
 */
import type { ImageTarget } from "../catalog.ts";
import { IMAGE_PUSH_TARGETS, INFRA_PUSH_TARGETS } from "../catalog.ts";
import { safeKey, RETRY, DAGGER_ENV } from "../lib/buildkite.ts";
import { k8sPlugin } from "../lib/k8s-plugin.ts";
import type { BuildkiteGroup, BuildkiteStep } from "../lib/types.ts";
import { WORKSPACE_DEPS } from "../../../../.dagger/src/deps.ts";

const MAIN_ONLY = "build.branch == pipeline.default_branch";

function imagePushStep(
  img: ImageTarget,
  dependsOn: string = "release",
): BuildkiteStep {
  const pkg = img.package ?? img.name;
  const deps = WORKSPACE_DEPS[pkg] ?? [];
  const depFlags = deps
    .flatMap((d: string) => [`--dep-names ${d}`, `--dep-dirs ./packages/${d}`])
    .join(" ");
  const cmd = [
    `DIGEST=$(dagger call push-image --pkg-dir ./packages/${pkg} --pkg ${img.name}`,
    depFlags,
    `--tsconfig ./tsconfig.base.json`,
    `--tag ghcr.io/${img.versionKey}:latest`,
    `--registry-username $GITHUB_USERNAME`,
    `--registry-password env:GH_TOKEN)`,
    `&& buildkite-agent meta-data set "digest:${img.versionKey}" "$DIGEST"`,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    label: `:docker: Push ${img.name}`,
    key: `push-${safeKey(img.name)}`,
    if: MAIN_ONLY,
    depends_on: dependsOn,
    command: cmd,
    timeout_in_minutes: 15,
    retry: RETRY,
    env: DAGGER_ENV,
    plugins: [
      k8sPlugin({
        cpu: "250m",
        memory: "512Mi",
        secrets: ["buildkite-argocd-token"],
      }),
    ],
  };
}

export function publishImagesGroup(
  images: readonly ImageTarget[] = IMAGE_PUSH_TARGETS,
): BuildkiteGroup {
  return {
    group: ":package: Publish Images",
    key: "publish-images",
    steps: images.map((img) => imagePushStep(img)),
  };
}

export function homelabImagesGroup(): BuildkiteGroup {
  return {
    group: ":kubernetes: Homelab Images",
    key: "homelab-images",
    steps: INFRA_PUSH_TARGETS.map((img) => imagePushStep(img)),
  };
}

export function allPushKeys(images: readonly ImageTarget[]): string[] {
  return images.map((img) => `push-${safeKey(img.name)}`);
}
