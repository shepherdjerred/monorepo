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
