import {
  fail,
  hasTrimmedLine,
  requireIncludes,
} from "./validate-pipeline-lib.ts";
import {
  parsePlaywrightVersionFile,
  playwrightPackageVersion,
  playwrightVersionFromDockerfile,
  PLAYWRIGHT_PACKAGE_TARGETS,
  PLAYWRIGHT_VERSION_FILE,
} from "./update-ci-image-pin-core.ts";

type ReleaseValidationOptions = {
  readonly pipeline: string;
  readonly prDryrun: string | undefined;
  readonly selectorStep: string | undefined;
  readonly stepBlocks: ReadonlyMap<string, string>;
};

function validateReleaseSteps({
  prDryrun,
  stepBlocks,
}: Pick<ReleaseValidationOptions, "prDryrun" | "stepBlocks">): void {
  const sites = stepBlocks.get("sites");
  requireIncludes(
    sites,
    "filters+=(--filter glitter)",
    "sites install closure is missing Glitter",
  );
  const scoutBetaRelease = stepBlocks.get("scout-beta-release");
  for (const required of [
    "--filter '@scout-for-lol/frontend'",
    "--filter '@scout-for-lol/app'",
    "--filter astro-opengraph-images",
    "--filter '@shepherdjerred/llm-models'",
    "--filter '@shepherdjerred/glitter-context'",
    "bun --no-install run --cwd packages/llm-models build",
    "bun --no-install run --cwd packages/astro-opengraph-images build",
    "bun --no-install run --cwd packages/glitter-context build",
  ]) {
    requireIncludes(
      scoutBetaRelease,
      required,
      `Scout beta release install closure is missing ${required}`,
    );
  }

  for (const [step, required] of [
    [
      "helm-push",
      [
        "buildkite-agent meta-data get image-digests",
        "HOMELAB_IMAGE_DIGESTS_JSON",
        "--filter homelab --filter '@homelab/cdk8s'",
        "suspend-auto-sync apps",
        "concurrency_group: monorepo/homelab-release",
        'buildkite-agent artifact upload "argocd-release-expected.json"',
      ],
    ],
    [
      "argocd-sync",
      [
        "buildkite-agent meta-data get image-digests",
        "--filter homelab --filter '@homelab/cdk8s'",
        "concurrency_group: monorepo/homelab-release",
        'artifact download "argocd-release-expected.json"',
        "reconcile-release argocd-release-expected.json",
        'sync apps --revision "$$apps_revision" --prune',
        "tree-health-wait apps",
      ],
    ],
    [
      "scout-beta-release",
      [
        "depends_on: [images, argocd-sync]",
        "shepherdjerred/scout-for-lol/beta",
        "prepare-state",
        "meta-data set scout-release-state",
        "deploy-beta --state",
      ],
    ],
    [
      "scout-tag-release",
      [
        "depends_on: scout-beta-release",
        "meta-data get scout-release-state",
        "tag-release --state",
      ],
    ],
    [
      "scout-prod-reconcile",
      ["resolve-prod-pin", "reconcile-prod-pin --prod-pin"],
    ],
  ] satisfies readonly (readonly [string, readonly string[]])[]) {
    const block = stepBlocks.get(step);
    for (const value of required) {
      requireIncludes(
        block,
        value,
        `${step} is missing release-state invariant ${value}`,
      );
    }
  }
  for (const step of ["helm-push", "argocd-sync"]) {
    if (stepBlocks.get(step)?.includes("cancel_on_build_failing") === true) {
      fail(
        `${step} must remain eligible after its qualified dependencies pass`,
      );
    }
  }

  for (const dependency of [
    '"packages/astro-opengraph-images/**"',
    '"packages/llm-models/**"',
    '"scripts/package.json"',
  ]) {
    requireIncludes(
      prDryrun,
      dependency,
      `pr-dryrun path gate is missing ${dependency}`,
    );
  }
  for (const [step, block] of [
    ["pr-dryrun", prDryrun],
    ["images", stepBlocks.get("images")],
  ] satisfies readonly (readonly [string, string | undefined])[]) {
    requireIncludes(
      block,
      "buildNumber:($$build|tonumber)",
      `${step} lets Buildkite consume jq's build variable`,
    );
  }
}

async function validatePublishing(
  stepBlocks: ReadonlyMap<string, string>,
): Promise<void> {
  const publish = stepBlocks.get("publish");
  if (
    publish === undefined ||
    publish.includes("--filter '@shepherdjerred/root-scripts'")
  ) {
    fail("publish restored an unnecessary root-scripts install");
  }
  for (const required of ["ci-changed.ts npm", "ci-changed.ts cooklang"]) {
    if (!publish.includes(required)) {
      fail(`publish is missing section gate ${required}`);
    }
  }

  const releasePlease = stepBlocks.get("release-please");
  const releaseInstall =
    "bun install --frozen-lockfile --filter '@shepherdjerred/root-scripts' --filter '@shepherdjerred/release-tools' --production";
  if (!hasTrimmedLine(releasePlease, releaseInstall)) {
    fail(
      `release-please lane is missing exact filtered install ${releaseInstall}`,
    );
  }

  requireIncludes(
    stepBlocks.get("version-commit-back"),
    "bun install --frozen-lockfile --filter '@shepherdjerred/root-scripts' --production",
    "version commit-back is missing its Zod-owning filtered install",
  );

  const jsonHelpers = await Bun.file("scripts/lib/json.ts").text();
  if (jsonHelpers.includes('from "zod"')) {
    fail("tiny JSON helpers restored a hidden install dependency");
  }
}

async function validateSelectorAndUpload({
  pipeline,
  selectorStep,
}: Pick<ReleaseValidationOptions, "pipeline" | "selectorStep">): Promise<void> {
  const selectorPreparation = await Bun.file(
    ".buildkite/scripts/prepare-ci-changed-base.ts",
  ).text();
  if (
    !selectorPreparation.includes("AbortSignal.timeout") ||
    selectorStep?.includes("timeout_in_minutes: 2") !== true
  ) {
    fail("main selector API lookup is not time-bounded");
  }

  const uploadPipeline = await Bun.file(
    ".buildkite/scripts/upload-pipeline.sh",
  ).text();
  const tofuPipeline = await Bun.file(
    "packages/homelab/src/tofu/buildkite/pipeline.tf",
  ).text();
  if (
    !uploadPipeline.includes("git diff --no-renames --name-only") ||
    !uploadPipeline.includes("--changed-files-path") ||
    !tofuPipeline.includes("sh .buildkite/scripts/upload-pipeline.sh")
  ) {
    fail("pipeline upload can omit the source side of renames");
  }
  for (const required of [
    "packages/homelab/src/cdk8s/src/resources/argo-applications/ci-base.DIGEST",
    ".buildkite/ci-playwright/DIGEST",
    "export CI_BASE_IMAGE CI_PLAYWRIGHT_IMAGE",
  ]) {
    if (!uploadPipeline.includes(required)) {
      fail(`pipeline upload is missing immutable CI image input ${required}`);
    }
  }
  if (pipeline.includes('".buildkite/**"')) {
    fail("PR lane selectors restored the blanket .buildkite glob");
  }
}

async function validatePlaywrightImage(): Promise<void> {
  const playwrightDockerfile = await Bun.file(
    ".buildkite/ci-playwright/Dockerfile",
  ).text();
  playwrightVersionFromDockerfile(playwrightDockerfile);
  for (const required of [
    'Bun.file("/ms-playwright/.docker-info").json()',
    "typeof info.driverVersion",
    "chromium-*/chrome-linux*/chrome",
    "firefox-*/firefox/firefox",
    "webkit-*/minibrowser-gtk/MiniBrowser",
  ]) {
    if (!playwrightDockerfile.includes(required)) {
      fail(
        `ci-playwright image is missing browser inventory check ${required}`,
      );
    }
  }
  for (const forbidden of ["apt-get", "bun x", "playwright install"]) {
    if (playwrightDockerfile.includes(forbidden)) {
      fail(`ci-playwright image restored bootstrap command ${forbidden}`);
    }
  }
  const activeVersion = parsePlaywrightVersionFile(
    await Bun.file(PLAYWRIGHT_VERSION_FILE).text(),
  );
  for (const target of PLAYWRIGHT_PACKAGE_TARGETS) {
    const packageVersion = playwrightPackageVersion(
      await Bun.file(target.path).text(),
      target,
    );
    if (packageVersion !== activeVersion) {
      fail(
        `${target.path} ${target.dependency} ${packageVersion} does not match active ci-playwright package version ${activeVersion}`,
      );
    }
  }
}

export async function validateReleasePipelineContracts(
  options: ReleaseValidationOptions,
): Promise<void> {
  validateReleaseSteps(options);
  await Promise.all([
    validatePublishing(options.stepBlocks),
    validateSelectorAndUpload(options),
    validatePlaywrightImage(),
  ]);
}
