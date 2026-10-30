import { App, Chart, Size } from "cdk8s";
import { parseAllDocuments } from "yaml";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { createSeaweedfsApp } from "./seaweedfs.ts";
import {
  createVeleroApp,
  MULTIPART_UPLOAD_MAX_PARTS,
  ZFS_STREAM_PART_SIZE,
} from "./velero.ts";

const ResourceSchema = z.object({
  kind: z.string(),
  metadata: z.object({ name: z.string() }).loose(),
  spec: z.unknown(),
});

const VeleroApplicationSchema = z.object({
  source: z.object({
    helm: z.object({
      valuesObject: z.object({
        configuration: z.object({
          volumeSnapshotLocation: z.array(
            z.object({
              name: z.string(),
              provider: z.string(),
              config: z.object({ multiPartChunkSize: z.string() }).loose(),
            }),
          ),
        }),
      }),
    }),
  }),
});

const ClaimSpecSchema = z.object({
  resources: z.object({ requests: z.object({ storage: z.string() }) }),
});

function synthesize(create: (chart: Chart) => unknown) {
  const app = new App();
  create(new Chart(app, "velero-test"));
  return parseAllDocuments(app.synthYaml()).map((document) =>
    ResourceSchema.parse(document.toJSON()),
  );
}

const BINARY_UNIT_EXPONENTS = new Map([
  ["Mi", 2],
  ["Gi", 3],
  ["Ti", 4],
]);

function binaryBytes(quantity: string): number {
  const match = /^(\d+)(Mi|Gi|Ti)$/.exec(quantity);
  const exponent = BINARY_UNIT_EXPONENTS.get(match?.[2] ?? "");
  if (exponent === undefined || match?.[1] === undefined) {
    throw new Error(`unsupported quantity ${quantity}`);
  }
  return Number(match[1]) * 1024 ** exponent;
}

describe("Velero ZFS stream uploads", () => {
  test("every ZFS snapshot location streams with the shared part size", () => {
    const application = synthesize(createVeleroApp).find(
      (resource) => resource.kind === "Application",
    );
    const locations = VeleroApplicationSchema.parse(application?.spec).source
      .helm.valuesObject.configuration.volumeSnapshotLocation;
    expect(locations.length).toBeGreaterThan(1);
    for (const location of locations) {
      expect(location.provider).toBe("openebs.io/zfspv-blockstore");
      expect(location.config.multiPartChunkSize).toBe(
        ZFS_STREAM_PART_SIZE.asString(),
      );
    }
  });

  test("a full stream of the largest backed-up volume fits in one upload", () => {
    const claim = synthesize(createSeaweedfsApp).find(
      (resource) =>
        resource.kind === "PersistentVolumeClaim" &&
        resource.metadata.name === "data-seaweedfs-volume-0",
    );
    const capacity = binaryBytes(
      ClaimSpecSchema.parse(claim?.spec).resources.requests.storage,
    );
    const ceiling =
      ZFS_STREAM_PART_SIZE.toMebibytes() *
      1024 ** 2 *
      MULTIPART_UPLOAD_MAX_PARTS;
    expect(capacity).toBe(Size.tebibytes(1).toMebibytes() * 1024 ** 2);
    expect(ceiling).toBeGreaterThanOrEqual(capacity);
  });
});
