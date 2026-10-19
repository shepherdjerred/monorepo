import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ArtifactVersionSchema } from "@shepherdjerred/delivery/contract";
import {
  verifyDeliveryPods,
  verifyCentralChartDependencies,
} from "./runtime.ts";

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

const hash = (bytes: string) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

function aliasFixture(changedChild = false, unknownDescriptor = false) {
  const config = `sha256:${"c".repeat(64)}`;
  const manifest = JSON.stringify({
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    config: {
      mediaType: "application/vnd.oci.image.config.v1+json",
      digest: config,
      size: 100,
    },
    layers: [
      {
        mediaType: "application/vnd.oci.image.layer.v1.tar+gzip",
        digest,
        size: 200,
      },
    ],
  });
  const runnable = {
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    digest: hash(manifest),
    size: Buffer.byteLength(manifest),
    platform: { os: "linux", architecture: "amd64" },
  };
  const index = (attestation: string, changed: boolean) =>
    JSON.stringify({
      schemaVersion: 2,
      mediaType: "application/vnd.oci.image.index.v1+json",
      manifests: [
        { ...runnable, ...(changed ? { digest } : {}) },
        {
          mediaType: runnable.mediaType,
          digest: attestation,
          size: 200,
          platform: { os: "unknown", architecture: "unknown" },
          annotations: {
            "vnd.docker.reference.type": unknownDescriptor
              ? "unknown"
              : "attestation-manifest",
            "vnd.docker.reference.digest": changed ? digest : runnable.digest,
          },
        },
      ],
    });
  const selected = index(digest, false);
  const observed = index(child, changedChild);
  const selectedArtifact = {
    ...artifact,
    digest: hash(selected),
    runtimeDigests: [runnable.digest],
  };
  const current = pod();
  current.spec.containers[0]!.image = `${artifact.uri}@${selectedArtifact.digest}`;
  const status = {
    ...current.status.containerStatuses[0]!,
    image: config,
    imageID: `${artifact.uri}@${hash(observed)}`,
  };
  const input = {
    ...current,
    status: { ...current.status, containerStatuses: [status] },
  };
  const manifests = new Map([
    [`${artifact.uri}@${hash(selected)}`, selected],
    [`${artifact.uri}@${hash(observed)}`, observed],
    [`${artifact.uri}@${hash(manifest)}`, manifest],
  ]);
  const read = async (reference: string) => {
    const value = manifests.get(reference);
    if (value === undefined) throw new Error("Unexpected manifest lookup");
    return value;
  };
  return { input, selectedArtifact, read, manifests, status };
}

describe("Delivery runtime evidence", () => {
  it("proves an attestation-only alternate index against immutable bytes and running config", async () => {
    const fixture = aliasFixture();
    await expect(
      verifyDeliveryPods(
        [fixture.input],
        [fixture.selectedArtifact],
        new Map(),
        fixture.read,
      ),
    ).resolves.toBeUndefined();
  });
  it("rejects a different runnable child even when its index has valid content addressing", async () => {
    const fixture = aliasFixture(true);
    await expect(
      verifyDeliveryPods(
        [fixture.input],
        [fixture.selectedArtifact],
        new Map(),
        fixture.read,
      ),
    ).rejects.toThrow("complete qualified runnable");
  });
  it("rejects foreign runtime references, changed configs and unrecognized index entries", async () => {
    const foreign = aliasFixture();
    foreign.status.imageID = foreign.status.imageID.replace(
      "shepherdjerred/arcade",
      "foreign/arcade",
    );
    await expect(
      verifyDeliveryPods(
        [foreign.input],
        [foreign.selectedArtifact],
        new Map(),
        foreign.read,
      ),
    ).rejects.toThrow("selected repository");
    const config = aliasFixture();
    config.status.image = digest;
    await expect(
      verifyDeliveryPods(
        [config.input],
        [config.selectedArtifact],
        new Map(),
        config.read,
      ),
    ).rejects.toThrow("Runtime config");
    const unknown = aliasFixture(false, true);
    await expect(
      verifyDeliveryPods(
        [unknown.input],
        [unknown.selectedArtifact],
        new Map(),
        unknown.read,
      ),
    ).rejects.toThrow("unrecognized");
  });
  it("rejects registry bytes that do not hash to their immutable reference", async () => {
    const fixture = aliasFixture();
    await expect(
      verifyDeliveryPods(
        [fixture.input],
        [fixture.selectedArtifact],
        new Map(),
        async (reference) => `${await fixture.read(reference)} `,
      ),
    ).rejects.toThrow("content digest");
  });
  it("checks the explicit shared Caddy dependency against selected chart manifests", () => {
    const image = `docker.io/shepherdjerred/caddy-s3proxy@${digest}`;
    const current = pod();
    current.spec.containers[0]!.image = image;
    const desired = [
      JSON.stringify({
        kind: "Deployment",
        spec: { template: { spec: { containers: [{ image }] } } },
      }),
    ];
    expect(() =>
      verifyCentralChartDependencies([current], desired),
    ).not.toThrow();
    current.spec.containers[0]!.image = `docker.io/shepherdjerred/caddy-s3proxy@sha256:${"c".repeat(64)}`;
    expect(() => verifyCentralChartDependencies([current], desired)).toThrow(
      "selected chart",
    );
    expect(() => verifyCentralChartDependencies([], desired)).toThrow(
      "no ready",
    );
    expect(() => verifyCentralChartDependencies([current], [])).toThrow(
      "reviewed Caddy",
    );
  });
  it("accepts ready Pods with selected index and verified platform digest", async () => {
    await expect(
      verifyDeliveryPods([pod()], [artifact]),
    ).resolves.toBeUndefined();
  });
  it("rejects healthy old images, wrong platform digests and missing components", async () => {
    const old = pod();
    old.spec.containers[0]!.image = `${artifact.uri}@sha256:${"c".repeat(64)}`;
    await expect(verifyDeliveryPods([old], [artifact])).rejects.toThrow(
      "selected image",
    );
    const wrong = pod();
    wrong.status.containerStatuses[0]!.imageID = `sha256:${"c".repeat(64)}`;
    await expect(verifyDeliveryPods([wrong], [artifact])).rejects.toThrow(
      "selected repository",
    );
    await expect(verifyDeliveryPods([], [artifact])).rejects.toThrow(
      "Not every",
    );
  });
  it("does not accept unready or terminating Pods", async () => {
    const unready = pod();
    unready.status.containerStatuses[0]!.ready = false;
    await expect(verifyDeliveryPods([unready], [artifact])).rejects.toThrow(
      "selected image",
    );
    await expect(
      verifyDeliveryPods(
        [{ ...pod(), metadata: { deletionTimestamp: "2026-01-01T00:00:00Z" } }],
        [artifact],
      ),
    ).rejects.toThrow("Not every");
  });
  it("ignores completed Job Pods without accepting them as running service evidence", async () => {
    const completed = {
      ...pod(),
      metadata: { ownerReferences: [{ kind: "Job" }] },
      status: { phase: "Succeeded" },
    };
    await expect(
      verifyDeliveryPods([completed, pod()], [artifact]),
    ).resolves.toBeUndefined();
    await expect(verifyDeliveryPods([completed], [artifact])).rejects.toThrow(
      "Not every",
    );
    await expect(
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
    ).rejects.toThrow("selected image");
  });
});
