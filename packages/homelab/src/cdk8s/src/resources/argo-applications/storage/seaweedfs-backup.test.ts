import { App, Chart } from "cdk8s";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { parseAllDocuments } from "yaml";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  literalAttribute,
  parseSynthesizedConfiguration,
  readSynthesizedConfiguration,
  synthesizedResources,
  type SynthesizedConfiguration,
} from "homelab/scripts/tofu/synthesized-configuration.ts";
import {
  BACKBLAZE_SEAWEEDFS_BACKUPS_ITEM_ID,
  createSeaweedfsBackup,
  SEAWEEDFS_BACKUP_EXCLUDED_BUCKETS,
} from "./seaweedfs-backup.ts";

const SEAWEEDFS_TOFU_STACK = path.join(
  import.meta.dirname,
  "../../../../../tofu/seaweedfs",
);

const EnvSchema = z.object({
  name: z.string(),
  valueFrom: z
    .object({
      secretKeyRef: z.object({ name: z.string(), key: z.string() }),
    })
    .optional(),
});

const ResourceSchema = z.object({
  kind: z.string(),
  metadata: z.object({ name: z.string() }).loose(),
  spec: z.unknown().optional(),
});

const DeploymentSpecSchema = z.object({
  replicas: z.number(),
  template: z.object({
    spec: z.object({
      containers: z.array(
        z.object({
          image: z.string(),
          args: z.array(z.string()),
          env: z.array(EnvSchema),
        }),
      ),
    }),
  }),
});

const ItemSpecSchema = z.object({ itemPath: z.string() });

function synthesize() {
  const app = new App();
  createSeaweedfsBackup(new Chart(app, "seaweedfs-backup-test"));
  return parseAllDocuments(app.synthYaml()).map((document) =>
    ResourceSchema.parse(document.toJSON()),
  );
}

/** Every literal `bucket` a synthesized stack's resources name. */
function synthesizedBuckets(configuration: SynthesizedConfiguration) {
  return new Set(
    synthesizedResources(configuration).flatMap((resource) => {
      const bucket = literalAttribute(resource.attributes, "bucket");
      return bucket === undefined ? [] : [bucket];
    }),
  );
}

/** Every bucket the seaweedfs OpenTofu stack declares, in either configuration format. */
async function declaredBuckets(): Promise<Set<string>> {
  const synthesized = await readSynthesizedConfiguration(SEAWEEDFS_TOFU_STACK);
  if (synthesized !== undefined) return synthesizedBuckets(synthesized);
  const names = new Set<string>();
  for (const file of await readdir(SEAWEEDFS_TOFU_STACK)) {
    if (!file.endsWith(".tf")) continue;
    const source = await Bun.file(path.join(SEAWEEDFS_TOFU_STACK, file)).text();
    for (const match of source.matchAll(/^\s*bucket\s*=\s*"([^"]+)"/gmu)) {
      if (match[1] !== undefined) names.add(match[1]);
    }
  }
  return names;
}

describe("SeaweedFS backup to Backblaze", () => {
  test("reads declared buckets from a synthesized stack as it does from HCL", () => {
    expect(
      synthesizedBuckets(
        parseSynthesizedConfiguration(
          JSON.stringify({
            resource: {
              aws_s3_bucket: {
                scout_prod: { bucket: "scout-prod" },
                each: { bucket: "${each.key}" },
              },
              aws_s3_bucket_versioning: {
                scout_prod: { bucket: "${aws_s3_bucket.scout_prod.id}" },
              },
            },
          }),
        ),
      ),
    ).toEqual(new Set(["scout-prod"]));
  });

  test("every excluded bucket is a declared SeaweedFS bucket", async () => {
    const declared = await declaredBuckets();
    for (const bucket of Object.keys(SEAWEEDFS_BACKUP_EXCLUDED_BUCKETS)) {
      expect(declared, bucket).toContain(bucket);
    }
  });

  test("buckets that must survive a SeaweedFS loss are backed up", () => {
    for (const bucket of [
      "delivery-artifacts",
      "glitter-discord-corpus",
      "homelab-tofu-state",
      "public-sjer-red",
      "scout-prod",
      "streambot-voice-captures",
      "tracker-attachments",
    ]) {
      expect(Object.keys(SEAWEEDFS_BACKUP_EXCLUDED_BUCKETS)).not.toContain(
        bucket,
      );
    }
  });

  test("filer.backup copies /buckets except the excluded ones, with the Backblaze key", () => {
    const resources = synthesize();
    const deployment = resources.find(
      (resource) => resource.kind === "Deployment",
    );
    const spec = DeploymentSpecSchema.parse(deployment?.spec);
    expect(spec.replicas).toBe(1);
    const [container] = spec.template.spec.containers;
    expect(container?.image).toMatch(/^chrislusf\/seaweedfs:/u);
    expect(container?.args).toContain("-filerPath=/buckets");
    expect(container?.args).toContain("-doDeleteFiles");
    // A start resumes from the filer's checkpoint; a snapshot would re-walk.
    expect(container?.args).not.toContain("-initialSnapshot");
    const excluded = container?.args
      .find((arg) => arg.startsWith("-filerExcludePaths="))
      ?.replace("-filerExcludePaths=", "")
      .split(",");
    expect(excluded?.toSorted()).toEqual(
      Object.keys(SEAWEEDFS_BACKUP_EXCLUDED_BUCKETS)
        .map((bucket) => `/buckets/${bucket}`)
        .toSorted(),
    );

    const item = resources.find(
      (resource) => resource.kind === "OnePasswordItem",
    );
    expect(ItemSpecSchema.parse(item?.spec).itemPath).toContain(
      BACKBLAZE_SEAWEEDFS_BACKUPS_ITEM_ID,
    );
    const keys = Object.fromEntries(
      (container?.env ?? []).map((env) => [
        env.name,
        env.valueFrom?.secretKeyRef,
      ]),
    );
    expect(keys).toEqual({
      WEED_SINK_S3_AWS_ACCESS_KEY_ID: {
        name: item?.metadata.name,
        key: "B2_ACCESS_KEY_ID",
      },
      WEED_SINK_S3_AWS_SECRET_ACCESS_KEY: {
        name: item?.metadata.name,
        key: "B2_SECRET_ACCESS_KEY",
      },
    });
  });
});
