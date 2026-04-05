/**
 * CI base image build and push steps.
 *
 * Builds the CI base image from .buildkite/ci-image/Dockerfile and pushes
 * to GHCR with both a versioned tag and :latest.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { RETRY, DAGGER_ENV } from "../lib/buildkite.ts";
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

export function ciBaseImageBuildStep(): BuildkiteStep {
  return {
    label: ":docker: Build ci-base",
    key: "build-ci-base",
    if: MAIN_ONLY,
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

export function ciBaseImagePushStep(): BuildkiteStep {
  const tagFlags = [
    `--tags ghcr.io/shepherdjerred/ci-base:${CI_IMAGE_VERSION}`,
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
