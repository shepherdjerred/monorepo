#!/usr/bin/env bun

/**
 * Guard the CI work-reduction invariants that are easy to regress in a large
 * static pipeline. This runs before verify so a malformed step cannot silently
 * disappear from the step-key observability or restore a full-root install.
 *
 * Division of labor: this file spot-checks specific critical inputs by string
 * matching at upload time; the generic "every ci-changed.sh lane path is
 * covered by its PR step's if_changed globs" subset property is owned by
 * ci-lane-coverage.test.ts (run in the root-scripts test suite).
 *
 * The generic parsing/checking helpers live in validate-pipeline-lib.ts; this
 * file keeps the content-specific invariant checks about particular lanes.
 */

import {
  assertNoImplicitBunRuntime,
  assertNoNestedBunRuntime,
  assertPackageTokens,
  assertUnfilteredInstallBelongsToVerify,
  collectStepBlocks,
  containerBlock,
  fail,
  hasTrimmedLine,
  requireAllPresent,
  requireIncludes,
  requireNonePresent,
  selectorLane,
  sharedPodAnchorBlock,
  SHARED_POD_ANCHORS,
  CHECKOUT_CONTAINER_ALIAS,
} from "./validate-pipeline-lib.ts";
import { validateCaddySmokeContracts } from "./validate-pipeline-caddy.ts";
const PIPELINE_PATH = ".buildkite/pipeline.yml";
const GLOBAL_IF_CHANGED = [
  '".buildkite/**"',
  '".mise.toml"',
  '"bun.lock"',
  '"bunfig.toml"',
  '"package.json"',
  '"patches/**"',
  '"turbo.json"',
];
const PATH_GATED_PR_KEYS = new Set([
  "playwright-e2e-pr",
  "resume-build-pr",
  "docker-e2e-pr",
  "trivy",
  "semgrep",
  "images-pr",
  "pr-dryrun",
]);
const pipeline = await Bun.file(PIPELINE_PATH).text();
const lines = pipeline.split("\n");

const checkoutContainerDefinition = [
  "  - checkout_container: &checkout_container",
  "      name: checkout",
  "      resources:",
  "        # The checkout writes the tracked tree into the memory-backed workspace.",
  '        requests: { cpu: "50m", memory: "1Gi" }',
  '        limits: { cpu: "400m", memory: "2Gi" }',
].join("\n");
if (!pipeline.includes(checkoutContainerDefinition)) {
  fail(
    "checkout container anchor must define the tested CPU and memory budget",
  );
}

for (const anchorName of SHARED_POD_ANCHORS) {
  const anchorBlock = sharedPodAnchorBlock(pipeline, anchorName);
  if (!hasTrimmedLine(anchorBlock, CHECKOUT_CONTAINER_ALIAS)) {
    fail(`shared pod anchor ${anchorName} does not patch checkout resources`);
  }
}

const verifyPodAnchor = sharedPodAnchorBlock(pipeline, "pod_verify_kubernetes");
for (const resourceLine of [
  'requests: { cpu: "1", memory: "14Gi", ephemeral-storage: "2Gi" }',
  'limits: { cpu: "7", memory: "20Gi", ephemeral-storage: "40Gi" }',
]) {
  if (!hasTrimmedLine(verifyPodAnchor, resourceLine)) {
    fail(`verify pod is missing measured resource budget ${resourceLine}`);
  }
}

const { stepStarts, keys, stepBlocks } = collectStepBlocks(lines, {
  sharedPodAnchors: SHARED_POD_ANCHORS,
  checkoutContainerAlias: CHECKOUT_CONTAINER_ALIAS,
  pathGatedPrKeys: PATH_GATED_PR_KEYS,
  globalIfChanged: GLOBAL_IF_CHANGED,
});

for (const key of [
  "verify",
  "playwright-e2e-main",
  "resume-build-main",
  "docker-e2e-main",
]) {
  const block = stepBlocks.get(key);
  requireIncludes(
    block,
    "depends_on: ci-selector-base",
    `main selector consumer ${key} does not wait for ci-selector-base`,
  );
}
const selectorStep = stepBlocks.get("ci-selector-base");
if (
  selectorStep === undefined ||
  !selectorStep.includes("soft_fail: true") ||
  !selectorStep.includes("prepare-ci-changed-base.sh")
) {
  fail("ci-selector-base must be a soft-fail metadata preparation step");
}

for (const key of ["playwright-e2e-pr", "playwright-e2e-main"]) {
  const block = stepBlocks.get(key);
  const install =
    "bun install --frozen-lockfile --filter sjer.red --filter '@shepherdjerred/monorepo'";
  if (!hasTrimmedLine(block, install)) {
    fail(`Playwright lane ${key} is missing exact filtered install ${install}`);
  }
  for (const required of [
    "bunx --no-install playwright install",
    "bunx --no-install turbo run build lint test test:e2e",
  ]) {
    requireIncludes(
      block,
      required,
      `Playwright lane ${key} is missing explicit tool closure ${required}`,
    );
  }
}

// The merged PR dry-run lane owns the helm-types drift gate, the tofu plans,
// and the print-only deploy rehearsals. Its install must stay the exact
// union of the sections' tool closures, and the two real-work sections must
// stay internally gated on their ci-changed lanes.
const prDryrun = stepBlocks.get("pr-dryrun");
const prDryrunInstall =
  "bun install --frozen-lockfile --filter '@shepherdjerred/root-scripts' --filter '@shepherdjerred/release-tools' --filter '@homelab/cdk8s'";
if (!hasTrimmedLine(prDryrun, prDryrunInstall)) {
  fail(`pr-dryrun is missing exact filtered install ${prDryrunInstall}`);
}
for (const required of [
  '- "packages/homelab/src/cdk8s/**"',
  '- "packages/homelab/src/helm-types/**"',
  "generate-helm-types --check",
  "ci-changed.sh helm-types",
  "ci-changed.sh tofu",
  "scripts/deploy-site.ts",
  "scripts/scout-site-release.ts",
  "helm-push.ts",
  "scripts/release.ts --dry-run",
]) {
  requireIncludes(
    prDryrun,
    required,
    `pr-dryrun is missing section content ${required}`,
  );
}

const ciChanged = await Bun.file(".buildkite/scripts/ci-changed.sh").text();
const ciChangedCommands = ciChanged
  .split("\n")
  .filter((line) => !/^\s*#/.test(line))
  .join("\n");
for (const forbidden of ["curl ", "jq ", "BUILDKITE_API_TOKEN"]) {
  if (ciChangedCommands.includes(forbidden)) {
    fail(`runtime CI selector restored unavailable dependency ${forbidden}`);
  }
}
for (const required of [
  "buildkite-agent meta-data get ci-changed-base",
  "scripts/lib/s3-static-site.ts",
  "scripts/lib/run.ts",
]) {
  if (!ciChanged.includes(required)) {
    fail(`runtime CI selector is missing ${required}`);
  }
}

for (const lane of ["site-scout", "sites", "scout-reconcile"]) {
  const block = selectorLane(ciChanged, lane);
  for (const dependency of [
    "packages/astro-opengraph-images",
    "packages/llm-models",
  ]) {
    if (!block.includes(dependency)) {
      fail(`runtime CI selector ${lane} is missing ${dependency}`);
    }
  }
  if (!block.includes("scripts/package.json")) {
    fail(`runtime CI selector ${lane} is missing scripts/package.json`);
  }
}

const selectImageTargets = await Bun.file(
  ".buildkite/scripts/select-image-targets.ts",
).text();
if (!selectImageTargets.includes('"--no-renames"')) {
  fail("image selection can omit a renamed source path");
}
if (!selectImageTargets.includes('"turbo.json"')) {
  fail("image selection can skip every target after turbo.json changes");
}
if (!selectImageTargets.includes('"tsconfig.base.json"')) {
  fail("image selection can skip every target after root tsconfig changes");
}
const scoutTsconfig = "packages/scout-for-lol/tsconfig.base.json";
if (!selectImageTargets.includes(`"${scoutTsconfig}"`)) {
  fail("image selection can skip Scout after its base tsconfig changes");
}

const caddyConfigInputs = [
  "packages/homelab/src/cdk8s/scripts/generate-caddyfile.ts",
  "packages/homelab/src/cdk8s/src/misc/common.ts",
  "packages/homelab/src/cdk8s/src/misc/s3-static-site.ts",
  "packages/homelab/src/cdk8s/src/resources/s3-static-sites/sites.ts",
];
const imagesPr = stepBlocks.get("images-pr");
requireIncludes(
  imagesPr,
  '- "scripts/package.json"',
  "images-pr path gate is missing the root-scripts workspace manifest",
);
requireIncludes(
  imagesPr,
  '- "tsconfig.base.json"',
  "images-pr path gate is missing the root TypeScript config",
);
requireIncludes(
  imagesPr,
  `- "${scoutTsconfig}"`,
  "images-pr path gate is missing the Scout base TypeScript config",
);
for (const caddyConfigInput of caddyConfigInputs) {
  if (!selectImageTargets.includes(`"${caddyConfigInput}"`)) {
    fail(`main image selector is missing Caddy input ${caddyConfigInput}`);
  }
  requireIncludes(
    imagesPr,
    `"${caddyConfigInput}"`,
    `images-pr path gate is missing Caddy input ${caddyConfigInput}`,
  );
}

const trivy = stepBlocks.get("trivy");
for (const required of [
  '".trivyignore"',
  '"**/go.mod"',
  '"**/go.sum"',
  '"**/Cargo.lock"',
  '"**/Cargo.toml"',
  '"**/bun.lock"',
  '"**/Podfile.lock"',
]) {
  requireIncludes(
    trivy,
    required,
    `Trivy path gate is missing vulnerability input ${required}`,
  );
}
for (const required of [
  'exclude: "sandbox/**"',
  "--skip-dirs node_modules",
  "--skip-dirs sandbox",
  "--skip-db-update",
  "claimName: buildkite-trivy-db",
  "mountPath: /buildkite/trivy-db",
  "readOnly: true",
]) {
  requireIncludes(
    trivy,
    required,
    `Trivy restored scanning for unshipped sandbox content: ${required}`,
  );
}

const semgrep = stepBlocks.get("semgrep");
for (const required of [
  '"**/*.h"',
  '"**/*.cjs"',
  '"**/*.lua"',
  '"**/*.rs"',
  '"**/*.swift"',
  '"**/*.tf"',
]) {
  requireIncludes(
    semgrep,
    required,
    `Semgrep path gate is missing supported source ${required}`,
  );
}

for (const [stepKey, expectedRequests] of [
  ["playwright-e2e-pr", 'requests: { cpu: "2", memory: "5Gi" }'],
  ["playwright-e2e-main", 'requests: { cpu: "2", memory: "5Gi" }'],
  ["resume-build-pr", 'requests: { cpu: "1", memory: "2Gi" }'],
  ["resume-build-main", 'requests: { cpu: "1", memory: "2Gi" }'],
  ["trivy", 'requests: { cpu: "500m", memory: "1Gi" }'],
  ["semgrep", 'requests: { cpu: "500m", memory: "1Gi" }'],
] satisfies readonly (readonly [string, string])[]) {
  const commandContainer = containerBlock(
    stepKey,
    stepBlocks.get(stepKey),
    "container-0",
  );
  if (!commandContainer.includes(expectedRequests)) {
    fail(
      `${stepKey} must transfer the checkout tmpfs memory request to the checkout container`,
    );
  }
}

for (const [stepKey, step] of [
  ["trivy", trivy],
  ["semgrep", semgrep],
] satisfies readonly (readonly [string, string | undefined])[]) {
  const scanner = containerBlock(stepKey, step, "container-0");
  if (!scanner.includes("allowPrivilegeEscalation: false")) {
    fail(`scanner container ${stepKey} permits privilege escalation`);
  }
}

const sites = stepBlocks.get("sites");
for (const required of [
  "filters+=(--filter glitter)",
  "--filter '@scout-for-lol/frontend'",
  "--filter '@scout-for-lol/app'",
  "--filter astro-opengraph-images",
  "--filter '@shepherdjerred/llm-models'",
  "bun --no-install run --cwd packages/llm-models build",
  "bun --no-install run --cwd packages/astro-opengraph-images build",
]) {
  requireIncludes(
    sites,
    required,
    `sites install closure is missing ${required}`,
  );
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

const publish = stepBlocks.get("publish");
if (
  publish === undefined ||
  publish.includes("--filter '@shepherdjerred/root-scripts'")
) {
  fail("publish restored an unnecessary root-scripts install");
}
for (const required of ["ci-changed.sh npm", "ci-changed.sh cooklang"]) {
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

const jsonHelpers = await Bun.file("scripts/lib/json.ts").text();
if (jsonHelpers.includes('from "zod"')) {
  fail("tiny JSON helpers restored a hidden install dependency");
}

const selectorPreparation = await Bun.file(
  ".buildkite/scripts/prepare-ci-changed-base.sh",
).text();
if (
  !selectorPreparation.includes("--connect-timeout") ||
  !selectorPreparation.includes("--max-time") ||
  !selectorStep.includes("timeout_in_minutes: 2")
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

assertUnfilteredInstallBelongsToVerify(lines, stepStarts);

// Bun auto-installs dependencies when a checkout has no node_modules. Every
// Buildkite step starts from a fresh pod, so an otherwise dependency-free
// `bun script.ts` can silently turn into a full root install. Require every
// runtime invocation to disable auto-install explicitly; intentional installs
// remain visible as `bun install`. bunx must also use --no-install so a missing
// filtered dependency fails instead of populating Bun's global cache.
const bakeImages = await Bun.file(".buildkite/scripts/bake-images.sh").text();
assertNoImplicitBunRuntime([
  { path: PIPELINE_PATH, source: pipeline },
  { path: ".buildkite/scripts/ci-changed.sh", source: ciChanged },
  { path: ".buildkite/scripts/bake-images.sh", source: bakeImages },
]);

await assertNoNestedBunRuntime([
  "scripts/lib/github-auth.ts",
  "scripts/release.ts",
  "scripts/deploy-site.ts",
  "scripts/scout-site-release.ts",
  "scripts/publish-npm.ts",
  "scripts/check-large-files.ts",
  "packages/scout-for-lol/scripts/build-bucket.ts",
  "packages/homelab/scripts/helm-push.ts",
  "packages/homelab/scripts/smoke-images.ts",
  "packages/homelab/src/cdk8s/scripts/check-caddyfile.ts",
  "packages/homelab/src/cdk8s/scripts/generate-helm-types.ts",
]);

await assertPackageTokens([
  [
    "packages/homelab/src/cdk8s/package.json",
    [
      '"typescript":',
      '"prettier":',
      '"bunx --no-install eslint',
      '"bunx --no-install tsc',
      '"generate-helm-types": "bun --no-install run',
      '"format:generated-helm": "prettier --no-config"',
    ],
  ],
  ["packages/sjer.red/package.json", ['"bunx --no-install playwright test']],
  ["scripts/package.json", ['"bunx --no-install eslint']],
  [
    "packages/release-tools/package.json",
    ['"release-please": "17.9.0"', '"release-please": "release-please"'],
  ],
]);

if (bakeImages.includes("ALWAYS_ON_TARGETS")) {
  fail("bake-images.sh restored the always-on image target workaround");
}
requireAllPresent(
  bakeImages,
  ["docker buildx bake --builder ci", "CADDYFILE_SMOKE_PATH"],
  (required) =>
    `bake-images.sh is missing production image contract ${required}`,
);
requireNonePresent(
  bakeImages,
  ["CI_BUILDX_", "--target", "image-build-manifest"],
  (forbidden) =>
    `bake-images.sh retained rejected Buildx experiment ${forbidden}`,
);
for (const forbidden of [
  "--load",
  "docker-env.sh",
  "DOCKER_HOST",
  "docker:28-dind",
]) {
  if (pipeline.includes(forbidden) || bakeImages.includes(forbidden)) {
    fail(`CI retained forbidden Docker-in-Docker path ${forbidden}`);
  }
}

const dockerBake = await Bun.file("docker-bake.hcl").text();
if (dockerBake.includes('variable "READ_CACHE"')) {
  fail("docker-bake.hcl retained the rejected Buildx experiment cache mode");
}

const buildCiImage = await Bun.file(
  ".buildkite/scripts/build-ci-image.sh",
).text();
if (
  !buildCiImage.includes(
    "docker buildx create --name ci --driver remote tcp://buildkitd-buildkitd-service.buildkitd.svc.cluster.local:1234",
  ) ||
  !buildCiImage.includes("--builder ci")
) {
  fail("build-ci-image.sh must use the remote production BuildKit builder");
}

await validateCaddySmokeContracts();

console.log(
  `[validate-pipeline] ${keys.size.toString()} command steps have unique keys, exact pod labels, and bounded installs`,
);
