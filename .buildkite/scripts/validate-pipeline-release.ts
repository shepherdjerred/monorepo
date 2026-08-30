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
  readonly prDryrun: string | undefined;
  readonly stepBlocks: ReadonlyMap<string, string>;
};

const ARGOCD_COMMAND_PREFIX =
  "bun --no-install packages/homelab/scripts/argocd.ts ";
const RELEASE_ROOT_SUBCOMMAND =
  'release-root apps argocd-release-expected.json --revision "$$apps_revision" --request-id "$BUILDKITE_BUILD_ID" --timeout 300';

export function validateAtomicRootSyncLifecycle(
  argocdSync: string | undefined,
): void {
  if (argocdSync === undefined) {
    fail("argocd-sync is missing the atomic identity-bound root sync");
  }
  const executableCommands = argocdSync
    .replaceAll(/\\\r?\n[\t ]*/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !line.startsWith("#"))
    .flatMap((line) =>
      line
        .split(ARGOCD_COMMAND_PREFIX)
        .slice(1)
        .map((command) => command.trim()),
    );
  // Every argocd.ts invocation counts. Allowlisting only the lifecycle
  // subcommands would let an unrelated one (suspend-auto-sync,
  // delete-application, health-wait) rejoin the step without failing here.
  if (
    executableCommands.length !== 1 ||
    executableCommands[0] !== RELEASE_ROOT_SUBCOMMAND
  ) {
    fail(
      "argocd-sync must contain exactly one identity-bound release-root command",
    );
  }
}

export function validateHomelabReleaseAdmission(
  stepBlocks: ReadonlyMap<string, string>,
): void {
  const admission = stepBlocks.get("homelab-release-admission");
  for (const required of [
    "homelab-release-admission.ts admit",
    "depends_on: verify",
  ]) {
    requireIncludes(
      admission,
      required,
      `homelab-release-admission is missing ${required}`,
    );
  }
  for (const step of [
    "helm-push",
    "tofu-apply-seaweedfs",
    "tofu-apply-tailscale",
    "tofu-apply-buildkite",
    "tofu-apply-arr",
    "tofu-apply-github",
    "tofu-posthog",
    "argocd-sync",
    "tofu-apply-cloudflare",
  ]) {
    const block = stepBlocks.get(step);
    for (const required of [
      "homelab-release-admission",
      "homelab-release-admission.ts consume",
      '"$$release_admission" = "superseded"',
      '"$$release_admission" != "admitted"',
    ]) {
      requireIncludes(
        block,
        required,
        `${step} is missing homelab release admission invariant ${required}`,
      );
    }
  }
  requireIncludes(
    stepBlocks.get("argocd-sync"),
    'artifact upload "homelab-release-result.json"',
    "argocd-sync must publish the applied-verified release receipt",
  );
}

function validateReleaseSteps({
  prDryrun,
  stepBlocks,
}: Pick<ReleaseValidationOptions, "prDryrun" | "stepBlocks">): void {
  validateHomelabReleaseAdmission(stepBlocks);
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
    "--filter '@scout-for-lol/docs-site'",
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
        "read-buildkite-handoff.ts image-digests",
        "HOMELAB_IMAGE_DIGESTS_JSON",
        "read-buildkite-handoff.ts version-catalog",
        "HOMELAB_VERSION_CATALOG_JSON",
        "--filter homelab --filter '@homelab/cdk8s'",
        "suspend-auto-sync apps",
        "concurrency_group: monorepo/homelab-release",
        'buildkite-agent artifact upload "argocd-release-expected.json"',
      ],
    ],
    [
      "argocd-sync",
      [
        "read-buildkite-handoff.ts image-digests",
        "--filter homelab --filter '@homelab/cdk8s'",
        "concurrency_group: monorepo/homelab-release",
        'artifact download "argocd-release-expected.json"',
        'release-root apps argocd-release-expected.json --revision "$$apps_revision" --request-id "$BUILDKITE_BUILD_ID"',
      ],
    ],
    [
      "scout-beta-release",
      [
        "depends_on:",
        "images",
        "argocd-sync",
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
  const argocdSync = stepBlocks.get("argocd-sync");
  validateAtomicRootSyncLifecycle(argocdSync);

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

const VERSION_COMMIT_BACK_INSTALL =
  ".buildkite/scripts/bun-install.sh --frozen-lockfile --filter '@shepherdjerred/root-scripts' --production";

export function validateVersionCommitBackInstall(
  stepBlock: string | undefined,
): void {
  if (!hasTrimmedLine(stepBlock, VERSION_COMMIT_BACK_INSTALL)) {
    fail(
      `version commit-back is missing exact isolated-linker install ${VERSION_COMMIT_BACK_INSTALL}`,
    );
  }
}

function validatePublishing(stepBlocks: ReadonlyMap<string, string>): void {
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
    ".buildkite/scripts/bun-install.sh --frozen-lockfile --filter '@shepherdjerred/root-scripts' --filter '@shepherdjerred/release-tools' --filter '@shepherdjerred/llm-models' --production";
  if (!hasTrimmedLine(releasePlease, releaseInstall)) {
    fail(
      `release-please lane is missing exact filtered install ${releaseInstall}`,
    );
  }
  const releaseCatalogBuildCommands = [
    "bun --no-install run --cwd packages/llm-models build",
    "bun --no-install run --cwd packages/llm-models build:runtime",
  ];
  if (
    !releaseCatalogBuildCommands.some((command) =>
      hasTrimmedLine(releasePlease, command),
    )
  ) {
    fail("release-please must build the model catalog before release scripts");
  }
  requireIncludes(
    releasePlease,
    "<<: *pod_light_kubernetes",
    "release-please is missing the light pod",
  );

  validateVersionCommitBackInstall(stepBlocks.get("version-commit-back"));
}

async function validateSelectorAndUpload(): Promise<void> {
  const pipeline = await Bun.file(".buildkite/pipeline.yml").text();
  const bootstrapPipeline = await Bun.file(
    ".buildkite/main-bootstrap.yml",
  ).text();
  const selectorPreparation = await Bun.file(
    ".buildkite/scripts/prepare-ci-changed-base.ts",
  ).text();
  if (
    !selectorPreparation.includes("AbortSignal.timeout") ||
    !bootstrapPipeline.includes("timeout_in_minutes: 5") ||
    !bootstrapPipeline.includes("select-main-pipeline.ts")
  ) {
    fail("main selector upload path is not time-bounded");
  }
  for (const required of [
    'image: "${CI_BASE_IMAGE}"',
    "imagePullPolicy: IfNotPresent",
    "serviceAccountName: buildkite-job",
    "automountServiceAccountToken: false",
    "name: BUILDKITE_READ_TOKEN",
    "name: buildkite-api-credentials",
    "name: buildkite-git-mirrors",
    "mountPath: /buildkite/git-mirrors",
  ]) {
    if (!bootstrapPipeline.includes(required)) {
      fail(`main bootstrap is missing ${required}`);
    }
  }

  const uploadPipeline = await Bun.file(
    ".buildkite/scripts/upload-pipeline.sh",
  ).text();
  const ciImageRefs = await Bun.file(
    ".buildkite/scripts/ci-image-refs.sh",
  ).text();
  const tofuPipeline = await Bun.file(
    "packages/homelab/src/tofu/buildkite/pipeline.tf",
  ).text();
  if (
    !uploadPipeline.includes("git diff --no-renames --name-only") ||
    !uploadPipeline.includes("--changed-files-path") ||
    !uploadPipeline.includes("main-bootstrap.yml") ||
    !tofuPipeline.includes("sh .buildkite/scripts/upload-pipeline.sh")
  ) {
    fail("pipeline upload can omit the source side of renames");
  }
  for (const required of [
    ".buildkite/ci-image/DIGEST",
    ".buildkite/ci-playwright/DIGEST",
    "export CI_BASE_IMAGE CI_PLAYWRIGHT_IMAGE",
  ]) {
    if (!ciImageRefs.includes(required)) {
      fail(`pipeline upload is missing immutable CI image input ${required}`);
    }
  }
  // Mirror-health guard (2026-08-02 pipeline-upload OOM): with the mirror
  // volume unmounted, the uploader's base fetch silently degrades to a
  // full-repo pack download that the LimitRange's default memory limit
  // OOM-kills. The uploader must keep checking its alternates before any
  // git operation, and the bootstrap pod must keep the mirror mount plus an
  // explicit memory limit so the LimitRange default can never apply.
  if (!uploadPipeline.includes("objects/info/alternates")) {
    fail("pipeline upload dropped the git alternates health guard");
  }
  const bootstrapMarker = "- name: container-0";
  const bootstrapStart = tofuPipeline.indexOf(bootstrapMarker);
  if (bootstrapStart === -1) {
    fail("bootstrap podSpecPatch is missing container-0");
  }
  // The block ends at the next SIBLING container entry (same indentation);
  // nested list items like volumeMounts entries are indented deeper.
  const lineStart = tofuPipeline.lastIndexOf("\n", bootstrapStart) + 1;
  const containerIndent = tofuPipeline.slice(lineStart, bootstrapStart);
  const nextContainer = tofuPipeline.indexOf(
    `\n${containerIndent}- name:`,
    bootstrapStart + bootstrapMarker.length,
  );
  const bootstrapContainer = tofuPipeline.slice(
    bootstrapStart,
    nextContainer === -1 ? tofuPipeline.length : nextContainer,
  );
  for (const required of [
    "resources:",
    "limits:",
    "memory:",
    "name: buildkite-git-mirrors",
    "mountPath: /buildkite/git-mirrors",
    "readOnly: true",
  ]) {
    if (!bootstrapContainer.includes(required)) {
      fail(
        `bootstrap container-0 is missing mirror/resource invariant ${required}`,
      );
    }
  }
  // Upload-time interpolation hazard: secret env sources must never reach the
  // bootstrap pod (their values would be baked into the uploaded pipeline),
  // and the CI image cannot be pinned there (its digest is computed by the
  // upload step itself).
  for (const forbidden of ["envFrom", "secretRef", "image:"]) {
    if (tofuPipeline.includes(forbidden)) {
      fail(`bootstrap pipeline must not contain ${forbidden}`);
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
  validatePublishing(options.stepBlocks);
  await Promise.all([validateSelectorAndUpload(), validatePlaywrightImage()]);
}
