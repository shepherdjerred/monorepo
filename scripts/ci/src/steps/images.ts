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
    `--tag ghcr.io/${img.versionKey}:latest`,
    `--registry-username shepherdjerred`,
    `--registry-password env:GH_TOKEN)`,
    `&& if [ -n "$DIGEST" ]; then buildkite-agent meta-data set "digest:${img.versionKey}" "$DIGEST"; else echo "WARN: empty digest for ${img.name}"; fi`,
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
    priority: 1,
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

/** Images that expose a health endpoint suitable for smoke testing. */
const SMOKE_TEST_TARGETS: Record<string, { port: number; healthPath: string }> =
  {
    birmel: { port: 8000, healthPath: "/" },
    "scout-for-lol": { port: 8000, healthPath: "/" },
    "starlight-karma-bot": { port: 8000, healthPath: "/" },
    "discord-plays-pokemon": { port: 8000, healthPath: "/" },
    "tasknotes-server": { port: 8000, healthPath: "/" },
  };

function smokeTestStep(img: ImageTarget): BuildkiteStep | null {
  const cfg = SMOKE_TEST_TARGETS[img.name];
  if (!cfg) return null;
  const pkg = img.package ?? img.name;
  const deps = WORKSPACE_DEPS[pkg] ?? [];
  const depFlags = deps
    .flatMap((d: string) => [`--dep-names ${d}`, `--dep-dirs ./packages/${d}`])
    .join(" ");
  const cmd = [
    `dagger call smoke-test`,
    `--image '(build-image --pkg-dir ./packages/${pkg} --pkg ${img.name} ${depFlags})'`,
    `--port ${cfg.port}`,
    `--health-path ${cfg.healthPath}`,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    label: `:heartbeat: Smoke ${img.name}`,
    key: `smoke-${safeKey(img.name)}`,
    if: MAIN_ONLY,
    depends_on: `push-${safeKey(img.name)}`,
    command: cmd,
    timeout_in_minutes: 5,
    retry: RETRY,
    env: DAGGER_ENV,
    soft_fail: true,
    plugins: [
      k8sPlugin({
        cpu: "100m",
        memory: "256Mi",
      }),
    ],
  };
}

export function publishImagesWithSmokeGroup(
  images: readonly ImageTarget[] = IMAGE_PUSH_TARGETS,
): BuildkiteGroup {
  const steps: BuildkiteStep[] = [];
  for (const img of images) {
    steps.push(imagePushStep(img));
    const smoke = smokeTestStep(img);
    if (smoke) steps.push(smoke);
  }
  return {
    group: ":package: Publish Images",
    key: "publish-images",
    steps,
  };
}

export function allPushKeys(images: readonly ImageTarget[]): string[] {
  return images.map((img) => `push-${safeKey(img.name)}`);
}
