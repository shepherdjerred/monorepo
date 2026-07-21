#!/usr/bin/env bun

/**
 * Guard the CI work-reduction invariants that are easy to regress in a large
 * static pipeline. This runs before verify so a malformed step cannot silently
 * disappear from the step-key observability or restore a full-root install.
 */

export {};

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
  "helm-types-drift-check",
  "docker-e2e-pr",
  "trivy",
  "semgrep",
  "tofu-plan",
  "images-pr",
  "sites-pr",
  "helm-pr",
  "release-pr",
]);
const BUILDX_BENCHMARK_KEYS = new Set([
  "buildx-io-reject-unsafe",
  "buildx-io-prepare",
  "buildx-io-tasknotes",
  "buildx-io-temporal",
  "buildx-io-infra",
  "buildx-io-report",
]);
const BUILDX_ORDINARY_GUARD =
  'build.env("CI_IO_BUILDX_BENCHMARK_MODE") == null';

function fail(message: string): never {
  throw new Error(`[validate-pipeline] ${message}`);
}

function scalar(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

const pipeline = await Bun.file(PIPELINE_PATH).text();
const lines = pipeline.split("\n");
const stepStarts = lines
  .map((line, index) => (/^  - label:/.test(line) ? index : -1))
  .filter((index) => index !== -1);
const keys = new Set<string>();
const stepBlocks = new Map<string, string>();

for (const [position, start] of stepStarts.entries()) {
  const end = stepStarts[position + 1] ?? lines.length;
  const blockLines = lines.slice(start, end);
  const block = blockLines.join("\n");
  if (!/^    command:/m.test(block)) {
    continue;
  }

  const keyLine = blockLines.find((line) => /^    key:/.test(line));
  if (keyLine === undefined) {
    fail(`command step at line ${(start + 1).toString()} has no key`);
  }
  const key = scalar(keyLine.replace(/^    key:\s*/, ""));
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(key)) {
    fail(`step key ${key} is not a stable lowercase identifier`);
  }
  if (keys.has(key)) {
    fail(`duplicate step key ${key}`);
  }
  keys.add(key);
  stepBlocks.set(key, block);

  const condition = blockLines.find((line) => /^    if:/.test(line));
  if (condition === undefined) {
    fail(`step ${key} has no condition`);
  }
  if (
    !BUILDX_BENCHMARK_KEYS.has(key) &&
    !condition.includes(BUILDX_ORDINARY_GUARD)
  ) {
    fail(`ordinary step ${key} can leak into a Buildx benchmark build`);
  }

  const labels = blockLines
    .filter((line) => /^\s+ci\.sjer\.red\/step-key:/.test(line))
    .map((line) => scalar(line.replace(/^\s+ci\.sjer\.red\/step-key:\s*/, "")));
  if (labels.length !== 1 || labels[0] !== key) {
    fail(
      `step ${key} must have exactly one ci.sjer.red/step-key label equal to its key`,
    );
  }

  if (PATH_GATED_PR_KEYS.has(key)) {
    if (!/^    if_changed:/m.test(block)) {
      fail(`PR lane ${key} has no native if_changed gate`);
    }
    for (const globalPath of GLOBAL_IF_CHANGED) {
      if (!block.includes(`- ${globalPath}`)) {
        fail(`PR lane ${key} is missing global if_changed path ${globalPath}`);
      }
    }
  }
}

for (const key of [
  "verify",
  "playwright-e2e-main",
  "resume-build-main",
  "docker-e2e-main",
]) {
  const block = stepBlocks.get(key);
  if (block === undefined || !block.includes("depends_on: ci-selector-base")) {
    fail(`main selector consumer ${key} does not wait for ci-selector-base`);
  }
}

const selectorStep = stepBlocks.get("ci-selector-base");
if (
  selectorStep === undefined ||
  !selectorStep.includes("soft_fail: true") ||
  !selectorStep.includes("prepare-ci-changed-base.sh")
) {
  fail("ci-selector-base must be a soft-fail metadata preparation step");
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

const selectImageTargets = await Bun.file(
  ".buildkite/scripts/select-image-targets.ts",
).text();
if (!selectImageTargets.includes('"--no-renames"')) {
  fail("image selection can omit a renamed source path");
}
if (!selectImageTargets.includes('"turbo.json"')) {
  fail("image selection can skip every target after turbo.json changes");
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
  if (trivy === undefined || !trivy.includes(required)) {
    fail(`Trivy path gate is missing vulnerability input ${required}`);
  }
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
  if (semgrep === undefined || !semgrep.includes(required)) {
    fail(`Semgrep path gate is missing supported source ${required}`);
  }
}

const sites = stepBlocks.get("sites");
for (const required of [
  "--filter '@scout-for-lol/frontend'",
  "--filter '@scout-for-lol/app'",
  "--filter astro-opengraph-images",
  "--filter '@shepherdjerred/llm-models'",
  "bun run --cwd packages/llm-models build",
  "bun run --cwd packages/astro-opengraph-images build",
]) {
  if (sites === undefined || !sites.includes(required)) {
    fail(`sites install closure is missing ${required}`);
  }
}

const benchmarkRejection = stepBlocks.get("buildx-io-reject-unsafe");
if (
  benchmarkRejection === undefined ||
  !benchmarkRejection.includes('build.branch != "ci-io-benchmark"') ||
  !benchmarkRejection.includes("build.pull_request.id != null") ||
  !benchmarkRejection.includes("exit 2")
) {
  fail("an unsafe benchmark-only build can publish a trusted CI status");
}
for (const key of BUILDX_BENCHMARK_KEYS) {
  if (key === "buildx-io-reject-unsafe") {
    continue;
  }
  const block = stepBlocks.get(key);
  if (
    block === undefined ||
    !block.includes('build.branch == "ci-io-benchmark"') ||
    !block.includes("build.pull_request.id == null")
  ) {
    fail(`Buildx benchmark step ${key} can run outside the dedicated branch`);
  }
}

const npmPublish = stepBlocks.get("npm-publish");
if (
  npmPublish === undefined ||
  npmPublish.includes("--filter '@shepherdjerred/root-scripts'")
) {
  fail("npm-publish restored an unnecessary root-scripts install");
}

const jsonHelpers = await Bun.file("scripts/lib/json.ts").text();
if (jsonHelpers.includes('from "zod"')) {
  fail("tiny JSON helpers restored a hidden install dependency");
}

const benchmarkPrepare = stepBlocks.get("buildx-io-prepare");
const benchmarkInfra = stepBlocks.get("buildx-io-infra");
if (
  benchmarkPrepare === undefined ||
  !benchmarkPrepare.includes("generate-caddyfile.ts caddyfile.generated") ||
  benchmarkInfra === undefined ||
  !benchmarkInfra.includes("depends_on: buildx-io-prepare") ||
  !benchmarkInfra.includes("CADDYFILE_SMOKE_PATH")
) {
  fail("Buildx infra fixture lacks an unmeasured Caddy preparation artifact");
}

const benchmarkReport = stepBlocks.get("buildx-io-report");
for (const required of [
  'artifact download "buildx-run-metadata.json"',
  "compare-buildx-metadata.ts",
  "timeout_in_minutes: 15",
]) {
  if (benchmarkReport === undefined || !benchmarkReport.includes(required)) {
    fail(`Buildx report is missing integrity contract ${required}`);
  }
}

const selectorPreparation = await Bun.file(
  ".buildkite/scripts/prepare-ci-changed-base.sh",
).text();
if (
  !selectorPreparation.includes("--connect-timeout") ||
  !selectorPreparation.includes("--max-time") ||
  selectorStep === undefined ||
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

const unfilteredInstalls = lines
  .map((line, index) => ({ line: line.trim(), index }))
  .filter((entry) => entry.line === "bun install --frozen-lockfile");
if (unfilteredInstalls.length !== 1) {
  fail(
    `expected one unfiltered root install, found ${unfilteredInstalls.length.toString()}`,
  );
}
const verifyStart = stepStarts.find((start) =>
  lines.slice(start, start + 4).some((line) => line === "    key: verify"),
);
const unfilteredInstall = unfilteredInstalls[0];
if (verifyStart === undefined || unfilteredInstall === undefined) {
  fail("verify or its unfiltered install disappeared");
}
const verifyEnd =
  stepStarts.find((start) => start > verifyStart) ?? lines.length;
if (
  unfilteredInstall.index < verifyStart ||
  unfilteredInstall.index >= verifyEnd
) {
  fail("the only unfiltered root install must belong to verify");
}

const bakeImages = await Bun.file(".buildkite/scripts/bake-images.sh").text();
if (bakeImages.includes("ALWAYS_ON_TARGETS")) {
  fail("bake-images.sh restored the always-on image target workaround");
}
for (const required of [
  "configure-buildx-driver.sh",
  'docker buildx bake --builder "$BUILDX_BUILDER"',
  "CI_IMAGE_VERSION",
  "CI_BUILDX_READ_CACHE",
  "--target",
]) {
  if (!bakeImages.includes(required)) {
    fail(`bake-images.sh is missing Buildx benchmark contract ${required}`);
  }
}

const buildxFixture = await Bun.file(
  ".buildkite/scripts/run-buildx-io-fixture.sh",
).text();
if (!buildxFixture.includes("export CI_BUILDX_READ_CACHE=false")) {
  fail("Buildx A/B fixtures can read a mutable registry cache");
}

const dockerBake = await Bun.file("docker-bake.hcl").text();
if (
  !dockerBake.includes('variable "READ_CACHE"') ||
  !dockerBake.includes('equal(READ_CACHE, "true")')
) {
  fail("docker-bake.hcl cannot disable mutable cache imports for A/B runs");
}

const buildCiImage = await Bun.file(
  ".buildkite/scripts/build-ci-image.sh",
).text();
if (
  !buildCiImage.includes("configure-buildx-driver.sh") ||
  !buildCiImage.includes('--builder "$BUILDX_BUILDER"')
) {
  fail("build-ci-image.sh bypasses the guarded Buildx selector");
}

const caddyCheck = await Bun.file(
  "packages/homelab/src/cdk8s/scripts/check-caddyfile.ts",
).text();
for (const hiddenBuild of [
  "caddy-s3proxy:dev",
  "docker buildx",
  "imageExists",
]) {
  if (caddyCheck.includes(hiddenBuild)) {
    fail(`check-caddyfile.ts restored hidden build path ${hiddenBuild}`);
  }
}

console.log(
  `[validate-pipeline] ${keys.size.toString()} command steps have unique keys, exact pod labels, and bounded installs`,
);
