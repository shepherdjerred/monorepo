/**
 * CI base image build and push steps.
 *
 * Builds the CI base image from .buildkite/ci-image/Dockerfile and pushes
 * to GHCR with both a versioned tag and :latest.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { RETRY, DAGGER_ENV, DRYRUN_FLAG } from "../lib/buildkite.ts";
import { k8sPlugin } from "../lib/k8s-plugin.ts";
import type { BuildkiteStep } from "../lib/types.ts";

const MAIN_ONLY = "build.branch == pipeline.default_branch";

const CI_IMAGE_VERSION = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../../.buildkite/ci-image/VERSION",
  ),
  "utf-8",
).trim();

function nextCiImageVersion(version: string): string {
  const parsed = Number(version);
  if (!Number.isInteger(parsed)) {
    throw new Error(`CI image version must be an integer, got "${version}"`);
  }
  return String(parsed + 1);
}

const NEXT_CI_IMAGE_VERSION = nextCiImageVersion(CI_IMAGE_VERSION);

export function ciBaseImageBuildStep(): BuildkiteStep {
  return {
    label: ":docker: Build ci-base",
    key: "build-ci-base",
    depends_on: "quality-gate",
    command: "dagger call build-ci-base-image --context ./.buildkite/ci-image",
    timeout_in_minutes: 15,
    priority: 1,
    retry: RETRY,
    env: DAGGER_ENV,
    plugins: [
      k8sPlugin({
        cpu: "250m",
        memory: "512Mi",
      }),
    ],
  };
}

export function ciBaseImagePushStep(
  version = NEXT_CI_IMAGE_VERSION,
): BuildkiteStep {
  const tagFlags = [
    `--tags ghcr.io/shepherdjerred/ci-base:${version}`,
    `--tags ghcr.io/shepherdjerred/ci-base:latest`,
    `--registry-username shepherdjerred`,
    `--registry-password env:GH_TOKEN`,
  ].join(" ");

  return {
    label: ":docker: Push ci-base",
    key: "push-ci-base",
    if: MAIN_ONLY,
    depends_on: "build-ci-base",
    command: `dagger call push-ci-base-image --context ./.buildkite/ci-image ${tagFlags}`,
    timeout_in_minutes: 15,
    priority: 1,
    retry: RETRY,
    env: DAGGER_ENV,
    plugins: [
      k8sPlugin({
        cpu: "250m",
        memory: "512Mi",
      }),
    ],
  };
}

export function ciBaseVersionCommitBackStep(
  version = NEXT_CI_IMAGE_VERSION,
): BuildkiteStep {
  return {
    label: ":bookmark: CI Base Version Commit-Back",
    key: "ci-base-version-commit-back",
    if: MAIN_ONLY,
    depends_on: "push-ci-base",
    command: `dagger call ci-base-version-commit-back --version "${version}" --gh-token env:GH_TOKEN${DRYRUN_FLAG}`,
    timeout_in_minutes: 10,
    priority: 1,
    retry: RETRY,
    env: DAGGER_ENV,
    concurrency: 1,
    concurrency_group: "monorepo/ci-base-version-commit-back",
    plugins: [
      k8sPlugin({
        cpu: "250m",
        memory: "512Mi",
      }),
    ],
  };
}
