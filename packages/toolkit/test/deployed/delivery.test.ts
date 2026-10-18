import { describe, expect, test } from "vitest";
import { deliveryVerdict } from "#lib/deployed/delivery.ts";
import type { DeliveryEvidence, RunningPod } from "#lib/deployed/types.ts";

const evidence: DeliveryEvidence = {
  environmentId: "arcade/prod",
  desired: "version:2",
  observed: "version:1",
  accepted: "version:1",
  observedAt: "2026-10-16T00:00:00.000Z",
  activeDeploymentId: "deployment:2",
  artifacts: [
    {
      component: "server",
      digest: "sha256:expected",
      runtimeDigests: [],
      sourceRevision: "a".repeat(40),
      containsCommit: true,
    },
  ],
};
const pod: RunningPod = {
  namespace: "arcade",
  pod: "server",
  container: "server",
  image: "repo@sha256:expected",
  imageID: "repo@sha256:expected",
  digest: "sha256:expected",
};

describe("PostgreSQL release evidence", () => {
  test("selected revision alone does not prove running state", () => {
    expect(deliveryVerdict(evidence, true, [])).toBe("SELECTED");
    expect(
      deliveryVerdict(evidence, true, [{ ...pod, digest: "sha256:other" }]),
    ).toBe("SELECTED");
  });
  test("runtime match does not mutate or infer acceptance", () => {
    expect(deliveryVerdict(evidence, true, [pod])).toBe("RUNNING");
    expect(evidence.accepted).toBe("version:1");
  });
  test("requires provenance containing the target commit and all image digests", () => {
    expect(
      deliveryVerdict(
        {
          ...evidence,
          artifacts: [
            {
              ...evidence.artifacts[0],
              component: "server",
              digest: "sha256:expected",
              runtimeDigests: [],
              sourceRevision: "a".repeat(40),
              containsCommit: false,
            },
          ],
        },
        true,
        [pod],
      ),
    ).toBe("PENDING");
    expect(
      deliveryVerdict(
        {
          ...evidence,
          artifacts: [
            ...evidence.artifacts,
            {
              component: "worker",
              digest: "sha256:worker",
              runtimeDigests: [],
              sourceRevision: "a".repeat(40),
              containsCommit: true,
            },
          ],
        },
        true,
        [pod],
      ),
    ).toBe("SELECTED");
    expect(deliveryVerdict(evidence, false, [pod])).toBe("NOT_MERGED");
  });
  test("missing selected artifact metadata is unknown", () => {
    expect(deliveryVerdict({ ...evidence, artifacts: [] }, true, [pod])).toBe(
      "UNKNOWN",
    );
  });
  test("accepts an attested platform digest for a multiarchitecture image", () => {
    const selected = {
      ...evidence,
      artifacts: evidence.artifacts.map((artifact) => ({
        ...artifact,
        runtimeDigests: ["sha256:platform"],
      })),
    };
    expect(
      deliveryVerdict(selected, true, [{ ...pod, digest: "sha256:platform" }]),
    ).toBe("RUNNING");
  });
});
