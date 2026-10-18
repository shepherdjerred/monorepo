#!/usr/bin/env bun

/**
 * Print the complete pipeline step model as JSON.
 *
 * The graph is generated rather than committed, so this is how an outside
 * checker such as the credential contract check sees every step, command and
 * grant without standing up the service.
 *
 * Images are placeholders. Nothing downstream inspects them, and resolving the
 * real ones would need network access and a commit to resolve them at.
 */

import { buildPipelineSteps } from "#src/pipeline/steps.ts";
import type { CiImages } from "#src/images.ts";
import { completionStep } from "#src/pipeline/completion.ts";
import { routeSteps } from "#src/pipeline/routing.ts";
import { draftPreflightStep } from "#src/pipeline/draft.ts";
import { benchmarkSteps } from "#src/pipeline/benchmark.ts";
import { DISABLED_PERFORMANCE } from "#src/performance-config.ts";

const PLACEHOLDER_DIGEST = `sha256:${"0".repeat(64)}`;

const PLACEHOLDER_IMAGES: CiImages = {
  base: `docker.io/shepherdjerred/ci-base@${PLACEHOLDER_DIGEST}`,
  playwright: `docker.io/shepherdjerred/ci-playwright@${PLACEHOLDER_DIGEST}`,
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

const gateImage = `docker.io/shepherdjerred/woodpecker-config-extension@${PLACEHOLDER_DIGEST}`;
const steps = buildPipelineSteps({
  deliveryPublication: true,
  images: PLACEHOLDER_IMAGES,
  trustedGateImage: gateImage,
  changedBase: "",
  imageReleaseBase: "",
});

// Include the dynamically appended verdict in admission and grant checks.
const routed = routeSteps(
  [
    ...steps,
    completionStep(steps, gateImage, "/app"),
    draftPreflightStep(PLACEHOLDER_IMAGES),
  ],
  {
    event: "pull_request",
    branch: "main",
    defaultBranch: "main",
    draft: false,
  },
  gateImage,
);
// Admission must cover the larger manual canary alongside ordinary workflows.
if (Bun.argv.includes("--include-canaries")) {
  routed.push(
    ...routeSteps(
      benchmarkSteps(
        PLACEHOLDER_IMAGES,
        {
          profile: "verify",
          variant: "candidate",
          cache: "cold",
          source: "0".repeat(40),
          feature: "scratch",
          main: false,
        },
        { ...DISABLED_PERFORMANCE, scratch: true },
        gateImage,
      ),
      {
        event: "manual",
        branch: "ci-canary/admission-proof",
        defaultBranch: "main",
        draft: false,
        maintenance: true,
      },
    ),
  );
}
// Inspect every container's own grants and maximum requests. Ordered containers
// share a workspace but never inherit the setup container's secrets.
const commands = routed.flatMap((step) => [
  step,
  ...(step.orderedSteps ?? []).map((command) => ({
    ...command,
    agentLabels: step.agentLabels,
  })),
]);
process.stdout.write(`${JSON.stringify(commands, null, 2)}\n`);
