import { describe, expect, it } from "vitest";
import { ArtifactVersionSchema } from "@shepherdjerred/delivery/contract";
import { verifyDeliveryPods } from "./runtime.ts";

const digest = `sha256:${"a".repeat(64)}`;
const child = `sha256:${"b".repeat(64)}`;
const artifact = ArtifactVersionSchema.parse({
  id: "image-42",
  component: "server",
  kind: "image",
  uri: "docker.io/shepherdjerred/arcade",
  digest,
  runtimeDigests: [child],
  version: "2.0.0-42",
  serviceId: "arcade",
  buildId: "build-42",
  sourceRevision: "a".repeat(40),
  createdAt: "2026-01-01T00:00:00.000Z",
});
function pod() {
  return {
    metadata: {},
    spec: {
      containers: [{ name: "server", image: `${artifact.uri}@${digest}` }],
    },
    status: {
      phase: "Running",
      containerStatuses: [
        {
          name: "server",
          ready: true,
          imageID: `docker-pullable://${artifact.uri}@${child}`,
          state: { running: {} },
        },
      ],
    },
  };
}

describe("Delivery runtime evidence", () => {
  it("accepts ready Pods with selected index and verified platform digest", () => {
    expect(() => verifyDeliveryPods([pod()], [artifact])).not.toThrow();
  });
  it("rejects healthy old images, wrong platform digests and missing components", () => {
    const old = pod();
    old.spec.containers[0]!.image = `${artifact.uri}@sha256:${"c".repeat(64)}`;
    expect(() => verifyDeliveryPods([old], [artifact])).toThrow(
      "selected image",
    );
    const wrong = pod();
    wrong.status.containerStatuses[0]!.imageID = `sha256:${"c".repeat(64)}`;
    expect(() => verifyDeliveryPods([wrong], [artifact])).toThrow(
      "selected image",
    );
    expect(() => verifyDeliveryPods([], [artifact])).toThrow("Not every");
  });
  it("does not accept unready or terminating Pods", () => {
    const unready = pod();
    unready.status.containerStatuses[0]!.ready = false;
    expect(() => verifyDeliveryPods([unready], [artifact])).toThrow(
      "selected image",
    );
    expect(() =>
      verifyDeliveryPods(
        [{ ...pod(), metadata: { deletionTimestamp: "2026-01-01T00:00:00Z" } }],
        [artifact],
      ),
    ).toThrow("Not every");
  });
  it("ignores completed Job Pods without accepting them as running service evidence", () => {
    const completed = {
      ...pod(),
      metadata: { ownerReferences: [{ kind: "Job" }] },
      status: { phase: "Succeeded" },
    };
    expect(() =>
      verifyDeliveryPods([completed, pod()], [artifact]),
    ).not.toThrow();
    expect(() => verifyDeliveryPods([completed], [artifact])).toThrow(
      "Not every",
    );
    expect(() =>
      verifyDeliveryPods(
        [
          {
            ...completed,
            metadata: { ownerReferences: [{ kind: "ReplicaSet" }] },
          },
          pod(),
        ],
        [artifact],
      ),
    ).toThrow("selected image");
  });
});
