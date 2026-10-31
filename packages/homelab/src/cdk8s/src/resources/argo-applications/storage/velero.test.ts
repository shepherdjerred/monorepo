import { App, Chart, Size } from "cdk8s";
import { parseAllDocuments } from "yaml";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  createVeleroApp,
  MULTIPART_UPLOAD_MAX_PARTS,
  VELERO_OBJECT_STORE,
  ZFS_STREAM_PART_SIZE,
} from "./velero.ts";

const ResourceSchema = z.object({
  kind: z.string(),
  metadata: z.object({ name: z.string() }).loose(),
  spec: z.unknown().optional(),
});

const ObjectStoreConfigSchema = z
  .object({ region: z.string(), s3Url: z.string() })
  .loose();

const VeleroApplicationSchema = z.object({
  source: z.object({
    helm: z.object({
      valuesObject: z.object({
        configuration: z.object({
          backupStorageLocation: z.array(
            z.object({
              name: z.string(),
              bucket: z.string(),
              config: ObjectStoreConfigSchema,
            }),
          ),
          volumeSnapshotLocation: z.array(
            z.object({
              name: z.string(),
              provider: z.string(),
              config: ObjectStoreConfigSchema.extend({
                bucket: z.string(),
                multiPartChunkSize: z.string(),
              }),
            }),
          ),
        }),
      }),
    }),
  }),
});

function veleroConfiguration() {
  const application = synthesize(createVeleroApp).find(
    (resource) => resource.kind === "Application",
  );
  return VeleroApplicationSchema.parse(application?.spec).source.helm
    .valuesObject.configuration;
}

function synthesize(create: (chart: Chart) => unknown) {
  const app = new App();
  create(new Chart(app, "velero-test"));
  return parseAllDocuments(app.synthYaml()).map((document) =>
    ResourceSchema.parse(document.toJSON()),
  );
}

describe("Velero object store", () => {
  // The plugin's expiry sweep refuses to delete when any storage location's
  // bucket or endpoint differs from the snapshot location's.
  test("every storage and snapshot location uses the one object store", () => {
    const configuration = veleroConfiguration();
    const locations = [
      ...configuration.backupStorageLocation.map((location) => ({
        bucket: location.bucket,
        ...location.config,
      })),
      ...configuration.volumeSnapshotLocation.map(
        (location) => location.config,
      ),
    ];
    expect(locations.length).toBeGreaterThan(2);
    for (const location of locations) {
      expect({
        bucket: location.bucket,
        region: location.region,
        s3Url: location.s3Url,
      }).toEqual(VELERO_OBJECT_STORE);
    }
  });
});

describe("Velero ZFS stream uploads", () => {
  test("every ZFS snapshot location streams with the shared part size", () => {
    const locations = veleroConfiguration().volumeSnapshotLocation;
    expect(locations.length).toBeGreaterThan(1);
    for (const location of locations) {
      expect(location.provider).toBe("openebs.io/zfspv-blockstore");
      expect(location.config.multiPartChunkSize).toBe(
        ZFS_STREAM_PART_SIZE.asString(),
      );
    }
  });

  test("a full stream of a 1 TiB volume fits in one upload", () => {
    const ceiling =
      ZFS_STREAM_PART_SIZE.toMebibytes() * MULTIPART_UPLOAD_MAX_PARTS;
    expect(ceiling).toBeGreaterThanOrEqual(Size.tebibytes(1).toMebibytes());
  });
});
