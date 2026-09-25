#!/usr/bin/env bun

/**
 * Print the complete pipeline step model as JSON.
 *
 * The credential contract checker used to read `.buildkite/pipeline.yml` and
 * `secret-grants.json`, which no longer exist: the graph is generated rather
 * than committed. This is how an outside checker still sees every step,
 * command and grant without standing up the service.
 *
 * Images are placeholders. Nothing downstream inspects them, and resolving the
 * real ones would need network access and a commit to resolve them at.
 */

import { buildPipelineSteps } from "#src/pipeline/steps.ts";
import type { CiImages } from "#src/images.ts";

const PLACEHOLDER_DIGEST = `sha256:${"0".repeat(64)}`;

const PLACEHOLDER_IMAGES: CiImages = {
  base: `ghcr.io/shepherdjerred/ci-base@${PLACEHOLDER_DIGEST}`,
  playwright: `ghcr.io/shepherdjerred/ci-playwright@${PLACEHOLDER_DIGEST}`,
  windowsCrossCompilerWinui: `ghcr.io/shepherdjerred/windows-cross-compiler-winui@${PLACEHOLDER_DIGEST}`,
  catalog: {
    "aquasec/trivy": "aquasec/trivy:0",
    "semgrep/semgrep": "semgrep/semgrep:0",
    "texlive/texlive": "texlive/texlive:0",
    "trmnl/trmnlp": "trmnl/trmnlp:0",
    "grafana/tempo": "grafana/tempo:0",
    "mikefarah/yq": "mikefarah/yq:0",
    "minio/mc": "minio/mc:0",
    "minio/minio": "minio/minio:0",
  },
};

const steps = buildPipelineSteps({
  images: PLACEHOLDER_IMAGES,
  changedBase: "",
  imageReleaseBase: "",
});

process.stdout.write(`${JSON.stringify(steps, null, 2)}\n`);
