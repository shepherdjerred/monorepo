import { expect, test, vi } from "vitest";
import { parseAllDocuments, stringify } from "yaml";
import {
  BootstrapControlPlaneSchema,
  verifyBootstrapControlPlane,
  verifyBootstrapControlPlaneArchive,
} from "./bootstrap-control-plane.ts";
import {
  BootstrapDescriptorSchema,
  bootstrapRootManifest,
} from "./bootstrap-selection.ts";
import { bootstrapArchiveNames } from "./bootstrap-publication.ts";

function fixture() {
  const bytes = new TextEncoder().encode("original CI chart archive");
  const image = {
    id: "original-image",
    buildId: "original-image-build",
    serviceId: "temporal",
    component: "image:temporal-worker",
    kind: "image",
    uri: "docker.io/shepherdjerred/temporal-worker",
    digest: `sha256:${"a".repeat(64)}`,
    version: "2.0.0-800",
    sourceRevision: "b".repeat(40),
    createdAt: "2026-10-17T00:00:00.000Z",
    runtimeDigests: [],
    requires: {},
    origin: { kind: "first-party" },
  };
  const chart = {
    ...image,
    id: "original-chart",
    buildId: "original-chart-build",
    serviceId: "delivery-control-plane",
    component: "chart:delivery-control-plane",
    kind: "chart",
    uri: "https://chartmuseum.tailnet-1a49.ts.net/charts/delivery-control-plane-2.0.0-801.tgz",
    version: "2.0.0-801",
    sourceRevision: "c".repeat(40),
    digest: `sha256:${new Bun.CryptoHasher("sha256").update(bytes).digest("hex")}`,
    requires: { "image:temporal-worker": image.digest },
  };
  const selected = BootstrapControlPlaneSchema.parse({ image, chart });
  const procedureSource = "d".repeat(40);
  const manual = (repository: string) => ({
    repository,
    sourceRevision: procedureSource,
    version: "2.0.0-900",
    digest: `sha256:${"e".repeat(64)}`,
  });
  const descriptor = BootstrapDescriptorSchema.parse({
    schema: "delivery-bootstrap/v1",
    sourceRevision: procedureSource,
    pullRequest: 99,
    deliveryUrl: "https://delivery.tailnet-1a49.ts.net",
    revision: "2.0.0-901",
    requestId: "11111111-1111-4111-8111-111111111111",
    targets: ["delivery-control-plane"],
    images: {
      woodpecker: manual(
        "docker.io/shepherdjerred/woodpecker-config-extension",
      ),
      delivery: manual("docker.io/shepherdjerred/delivery"),
    },
    controlPlane: selected,
  });
  return { bytes, selected, descriptor };
}

test("control-plane bootstrap retains original qualified IDs, sources and chart archive instead of repackaging", async () => {
  const { descriptor, selected } = fixture();
  const read = vi.fn(async (query: unknown) => {
    const value = Object.values(selected).find((artifact) =>
      JSON.stringify(query).includes(artifact.component),
    );
    if (value === undefined) throw new Error("Wrong qualified artifact query");
    return value;
  });
  await verifyBootstrapControlPlane(selected, "/unused", read);
  expect(read).toHaveBeenCalledTimes(2);
  expect(bootstrapArchiveNames(descriptor)).toEqual(["apps"]);
  const manifest = {
    apiVersion: "argoproj.io/v1alpha1",
    kind: "Application",
    metadata: {
      name: "delivery-control-plane",
      annotations: {
        "delivery.shepherdjerred.com/environment":
          "delivery-control-plane/prod",
      },
    },
    spec: {
      source: {
        repoURL: "https://chartmuseum.tailnet-1a49.ts.net",
        chart: "delivery-control-plane",
        targetRevision: "~2.0.0-0",
      },
      destination: { namespace: "temporal" },
      syncPolicy: { automated: { enabled: false } },
    },
  };
  const result = parseAllDocuments(
    bootstrapRootManifest(stringify(manifest), [], descriptor, ""),
  )[0]?.toJSON();
  expect(result.spec.source).toEqual({
    repoURL: "https://chartmuseum.tailnet-1a49.ts.net",
    chart: "delivery-control-plane",
    targetRevision: selected.chart.version,
    helm: {
      parameters: [
        {
          name: "delivery.images.delivery-control-plane",
          value: `${selected.image.uri}:${selected.image.version}@${selected.image.digest}`,
          forceString: true,
        },
      ],
    },
  });
  expect(
    result.metadata.annotations["delivery.shepherdjerred.com/environment"],
  ).toBeUndefined();
  expect(descriptor.sourceRevision).not.toBe(selected.image.sourceRevision);
  expect(descriptor.sourceRevision).not.toBe(selected.chart.sourceRevision);
  expect(descriptor.controlPlane).toEqual(selected);
});

test("qualified catalog lookup cannot be replaced by a descriptor or relabeled provenance", async () => {
  const { selected, descriptor } = fixture();
  await expect(
    verifyBootstrapControlPlane(selected, "/unused", async () => {
      throw new Error("NOT_FOUND");
    }),
  ).rejects.toThrow("NOT_FOUND");
  await expect(
    verifyBootstrapControlPlane(selected, "/unused", async () => ({
      ...selected.image,
      buildId: "borrowed-build",
    })),
  ).rejects.toThrow("identity differs");
  expect(() =>
    BootstrapDescriptorSchema.parse({ ...descriptor, controlPlane: undefined }),
  ).toThrow("qualified");
  expect(() =>
    BootstrapDescriptorSchema.parse({
      ...descriptor,
      images: {
        ...descriptor.images,
        "delivery-control-plane": descriptor.images.delivery,
      },
    }),
  ).toThrow();
  expect(() =>
    BootstrapControlPlaneSchema.parse({
      ...selected,
      chart: {
        ...selected.chart,
        requires: { "image:temporal-worker": `sha256:${"f".repeat(64)}` },
      },
    }),
  ).toThrow("compatible");
});

test("original archive content digest is independently inspected before selection", async () => {
  const { bytes, selected } = fixture();
  await expect(
    verifyBootstrapControlPlaneArchive(
      selected,
      async () => new Response(bytes),
    ),
  ).rejects.toThrow("Cannot render original qualified");
  await expect(
    verifyBootstrapControlPlaneArchive(
      selected,
      async () => new Response("different archive"),
    ),
  ).rejects.toThrow("qualified digest");
  await expect(
    verifyBootstrapControlPlaneArchive(
      selected,
      async () => new Response(null, { status: 404 }),
    ),
  ).rejects.toThrow("original qualified");
});
