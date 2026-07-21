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

  if (blockLines.find((line) => /^    if:/.test(line)) === undefined) {
    fail(`step ${key} has no condition`);
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

function selectorLane(lane: string): string {
  const startMarker = `  ${lane})\n`;
  const start = ciChanged.indexOf(startMarker);
  if (start === -1) {
    fail(`runtime CI selector is missing lane ${lane}`);
  }
  const blockStart = start + startMarker.length;
  const blockEnd = ciChanged.indexOf("\n    ;;", blockStart);
  if (blockEnd === -1) {
    fail(`runtime CI selector lane ${lane} has no terminator`);
  }
  return ciChanged.slice(blockStart, blockEnd);
}

for (const lane of [
  "site-scout",
  "sites",
  "scout-promotion",
  "scout-reconcile",
]) {
  const block = selectorLane(lane);
  for (const dependency of [
    "packages/astro-opengraph-images",
    "packages/llm-models",
  ]) {
    if (!block.includes(dependency)) {
      fail(`runtime CI selector ${lane} is missing ${dependency}`);
    }
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
if (imagesPr === undefined || !imagesPr.includes('- "scripts/package.json"')) {
  fail("images-pr path gate is missing the root-scripts workspace manifest");
}
if (imagesPr === undefined || !imagesPr.includes('- "tsconfig.base.json"')) {
  fail("images-pr path gate is missing the root TypeScript config");
}
if (imagesPr === undefined || !imagesPr.includes(`- "${scoutTsconfig}"`)) {
  fail("images-pr path gate is missing the Scout base TypeScript config");
}
for (const caddyConfigInput of caddyConfigInputs) {
  if (!selectImageTargets.includes(`"${caddyConfigInput}"`)) {
    fail(`main image selector is missing Caddy input ${caddyConfigInput}`);
  }
  if (imagesPr === undefined || !imagesPr.includes(`"${caddyConfigInput}"`)) {
    fail(`images-pr path gate is missing Caddy input ${caddyConfigInput}`);
  }
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
for (const required of [
  'exclude: "sandbox/**"',
  "--skip-dirs node_modules",
  "--skip-dirs sandbox",
]) {
  if (trivy === undefined || !trivy.includes(required)) {
    fail(`Trivy restored scanning for unshipped sandbox content: ${required}`);
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

function containerBlock(
  stepKey: string,
  step: string | undefined,
  containerName: string,
): string {
  if (step === undefined) {
    fail(`pipeline is missing step ${stepKey}`);
  }
  const marker = `              - name: ${containerName}\n`;
  const start = step.indexOf(marker);
  if (start === -1) {
    fail(`step ${stepKey} is missing container ${containerName}`);
  }
  const blockStart = start + marker.length;
  const nextContainer = step.indexOf("\n              - name:", blockStart);
  return step.slice(
    blockStart,
    nextContainer === -1 ? step.length : nextContainer,
  );
}

for (const [stepKey, step] of [
  ["trivy", trivy],
  ["semgrep", semgrep],
] satisfies ReadonlyArray<readonly [string, string | undefined]>) {
  const scanner = containerBlock(stepKey, step, "container-0");
  if (!scanner.includes("allowPrivilegeEscalation: false")) {
    fail(`scanner container ${stepKey} permits privilege escalation`);
  }
}

const sites = stepBlocks.get("sites");
for (const required of [
  "--filter '@scout-for-lol/frontend'",
  "--filter '@scout-for-lol/app'",
  "--filter astro-opengraph-images",
  "--filter '@shepherdjerred/llm-models'",
  "bun --no-install run --cwd packages/llm-models build",
  "bun --no-install run --cwd packages/astro-opengraph-images build",
]) {
  if (sites === undefined || !sites.includes(required)) {
    fail(`sites install closure is missing ${required}`);
  }
}

const sitesPr = stepBlocks.get("sites-pr");
for (const dependency of [
  '"packages/astro-opengraph-images/**"',
  '"packages/llm-models/**"',
]) {
  if (sitesPr === undefined || !sitesPr.includes(dependency)) {
    fail(`sites-pr path gate is missing ${dependency}`);
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

// Bun auto-installs dependencies when a checkout has no node_modules. Every
// Buildkite step starts from a fresh pod, so an otherwise dependency-free
// `bun script.ts` can silently turn into a full root install. Require every
// runtime invocation to disable auto-install explicitly; intentional installs
// remain visible as `bun install`, and bunx remains explicit for pinned CLIs.
const bakeImages = await Bun.file(".buildkite/scripts/bake-images.sh").text();
const implicitBunInstall = /\bbun\s+(?!install(?:\s|$)|--no-install(?:\s|$))/g;
const runtimeCommandSources: { path: string; source: string }[] = [
  { path: PIPELINE_PATH, source: pipeline },
  { path: ".buildkite/scripts/ci-changed.sh", source: ciChanged },
  { path: ".buildkite/scripts/bake-images.sh", source: bakeImages },
];
for (const { path, source } of runtimeCommandSources) {
  const commands = source
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
  const implicitMatch = implicitBunInstall.exec(commands);
  implicitBunInstall.lastIndex = 0;
  if (implicitMatch !== null) {
    const beforeMatch = commands.slice(0, implicitMatch.index);
    const line = beforeMatch.split("\n").length;
    fail(
      `Bun runtime in ${path} at filtered line ${line.toString()} can auto-install dependencies`,
    );
  }
}

// The shell-level scan cannot see Bun processes launched by the automation
// scripts themselves. Check every child-Bun launcher reachable from a
// dependency-minimized pipeline lane and allow only explicit no-install
// runtimes or Bun subcommands that do not execute repository code.
const automationSources = [
  "scripts/lib/github-auth.ts",
  "scripts/deploy-site.ts",
  "scripts/scout-site-release.ts",
  "scripts/publish-npm.ts",
  "scripts/check-large-files.ts",
  "packages/scout-for-lol/scripts/build-bucket.ts",
  "packages/homelab/scripts/helm-push.ts",
  "packages/homelab/scripts/smoke-images.ts",
  "packages/homelab/src/cdk8s/scripts/check-caddyfile.ts",
  "packages/homelab/src/cdk8s/scripts/generate-helm-types.ts",
];
const implicitChildBun =
  /\[\s*"bun",(?!\s*"(?:--no-install|install|x|publish)")/s;
const implicitBuildCommand = /buildCmd:\s*["'`]bun\s+(?!--no-install(?:\s|$))/;
const implicitTaggedBun =
  /(?:Bun\.)?\$`bun\s+(?!--no-install(?:\s|$)|install(?:\s|$)|x(?:\s|$)|publish(?:\s|$))/;
for (const path of automationSources) {
  const source = await Bun.file(path).text();
  if (
    implicitChildBun.test(source) ||
    implicitBuildCommand.test(source) ||
    implicitTaggedBun.test(source)
  ) {
    fail(`nested Bun runtime in ${path} can auto-install dependencies`);
  }
}

if (bakeImages.includes("ALWAYS_ON_TARGETS")) {
  fail("bake-images.sh restored the always-on image target workaround");
}
for (const required of [
  "docker buildx bake --builder ci",
  "CADDYFILE_SMOKE_PATH",
]) {
  if (!bakeImages.includes(required)) {
    fail(`bake-images.sh is missing production image contract ${required}`);
  }
}
for (const forbidden of ["CI_BUILDX_", "--target", "image-build-manifest"]) {
  if (bakeImages.includes(forbidden)) {
    fail(`bake-images.sh retained rejected Buildx experiment ${forbidden}`);
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
    "docker buildx create --name ci --driver docker-container",
  ) ||
  !buildCiImage.includes("--builder ci")
) {
  fail("build-ci-image.sh must use the production docker-container builder");
}

const caddyCheck = await Bun.file(
  "packages/homelab/src/cdk8s/scripts/check-caddyfile.ts",
).text();
for (const hiddenBuild of [
  '"docker"',
  "caddy-s3proxy:dev",
  "docker buildx",
  "imageExists",
]) {
  if (caddyCheck.includes(hiddenBuild)) {
    fail(`check-caddyfile.ts restored hidden build path ${hiddenBuild}`);
  }
}

const imageSmoke = await Bun.file(
  "packages/homelab/scripts/smoke-images.ts",
).text();
for (const required of [
  'const image = "caddy-s3proxy:dev"',
  'process.env["CADDYFILE_SMOKE_PATH"]',
  "caddy validate --config /tmp/Caddyfile --adapter caddyfile",
]) {
  if (!imageSmoke.includes(required)) {
    fail(`infra image smoke is missing Caddy validation contract ${required}`);
  }
}

console.log(
  `[validate-pipeline] ${keys.size.toString()} command steps have unique keys, exact pod labels, and bounded installs`,
);
