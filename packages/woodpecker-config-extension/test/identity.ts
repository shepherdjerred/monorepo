import type { PipelineIdentity } from "#src/pipeline/emit.ts";
import type { CiImages } from "#src/images.ts";
import { buildPipelineSteps } from "#src/pipeline/steps.ts";

/**
 * Pipeline identity used by emitter tests.
 *
 * Every field is stamped onto the generated pod metadata, so the values are
 * deliberately distinguishable from one another: a test asserting on the
 * commit label would still pass if the emitter wrote the branch there.
 */
export const TEST_IDENTITY: PipelineIdentity = {
  commit: "0123456789abcdef0123456789abcdef01234567",
  branch: "feature/telemetry",
  linkUrl: "https://github.com/shepherdjerred/monorepo/commit/0123456789ab",
};

/**
 * Image set for tests that build the whole step model.
 *
 * The values only have to be well-formed; nothing under test resolves them.
 */
export const TEST_IMAGES: CiImages = {
  base: `ghcr.io/shepherdjerred/ci-base@sha256:${"a".repeat(64)}`,
  playwright: `ghcr.io/shepherdjerred/ci-playwright@sha256:${"b".repeat(64)}`,
  windowsCrossCompilerWinui: `ghcr.io/shepherdjerred/windows-cross-compiler-winui@sha256:${"c".repeat(64)}`,
  catalog: {
    "aquasec/trivy": "aquasec/trivy:0.72.0",
    "semgrep/semgrep": "semgrep/semgrep:1.170.0",
    "texlive/texlive": "texlive/texlive:TL2024-historic",
    "trmnl/trmnlp": "trmnl/trmnlp:v0.11.0",
    "grafana/tempo": "grafana/tempo:3.0.3",
    "mikefarah/yq": "mikefarah/yq:latest",
    "minio/mc": "minio/mc:RELEASE",
    "minio/minio": "minio/minio:RELEASE",
  },
};

/** The whole step model, built from the fixtures above. */
export function testPipelineSteps() {
  return buildPipelineSteps({
    images: TEST_IMAGES,
    changedBase: "x",
    imageReleaseBase: "x",
  });
}
