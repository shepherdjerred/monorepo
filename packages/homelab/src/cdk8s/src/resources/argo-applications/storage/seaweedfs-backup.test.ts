import { App, Chart } from "cdk8s";
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
  SEAWEEDFS_BACKUP_CONCURRENCY,
  SEAWEEDFS_BACKUP_EXCLUDED_BUCKETS,
  SEAWEEDFS_BACKUP_REPLICATION_TOML,
  SEAWEEDFS_BACKUP_WAIT_FOR_FILER,
  SEAWEEDFS_RETIRED_BACKUP_EXCLUDED_BUCKETS,
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
          command: z.array(z.string()),
          args: z.array(z.string()),
          env: z.array(EnvSchema),
          resources: z.object({
            limits: z.object({ memory: z.string() }),
          }),
        }),
      ),
    }),
  }),
});

const ItemSpecSchema = z.object({ itemPath: z.string() });

const PortSchema = z.object({ port: z.number(), protocol: z.string() });
const NetworkPolicySpecSchema = z.object({
  policyTypes: z.array(z.string()),
  ingress: z.array(z.unknown()),
  egress: z.array(
    z.object({
      to: z.array(
        z
          .object({
            podSelector: z
              .object({ matchLabels: z.record(z.string(), z.string()) })
              .optional(),
            ipBlock: z.object({ cidr: z.string() }).optional(),
          })
          .loose(),
      ),
      ports: z.array(PortSchema),
    }),
  ),
});

/** A replication.toml `[sink.s3]` integer setting. */
function sinkSetting(name: string): number {
  const prefix = `${name} = `;
  const line = SEAWEEDFS_BACKUP_REPLICATION_TOML.split("\n").find((entry) =>
    entry.startsWith(prefix),
  );
  return Number(line?.slice(prefix.length));
}

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

/** Every bucket the synthesized seaweedfs OpenTofu stack declares. */
async function declaredBuckets(): Promise<Set<string>> {
  return synthesizedBuckets(
    await readSynthesizedConfiguration(SEAWEEDFS_TOFU_STACK),
  );
}

describe("SeaweedFS backup to Backblaze", () => {
  test("reads only literal bucket names from a synthesized stack", () => {
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

  test("every excluded bucket is a declared SeaweedFS bucket or a retired changelog exclusion", async () => {
    const declared = await declaredBuckets();
    for (const bucket of Object.keys(SEAWEEDFS_BACKUP_EXCLUDED_BUCKETS)) {
      if (SEAWEEDFS_RETIRED_BACKUP_EXCLUDED_BUCKETS.has(bucket)) {
        expect(declared, bucket).not.toContain(bucket);
      } else {
        expect(declared, bucket).toContain(bucket);
      }
    }
    for (const retired of SEAWEEDFS_RETIRED_BACKUP_EXCLUDED_BUCKETS) {
      expect(Object.keys(SEAWEEDFS_BACKUP_EXCLUDED_BUCKETS)).toContain(retired);
    }
  });

  test("buckets that must survive a SeaweedFS loss are backed up", () => {
    for (const bucket of [
      "delivery-artifacts",
      "glitter-discord-corpus",
      "homelab-tofu-state",
      "private-sjer-red",
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

  test("upload buffers stay well inside the memory limit", () => {
    const [container] = DeploymentSpecSchema.parse(
      synthesize().find((resource) => resource.kind === "Deployment")?.spec,
    ).template.spec.containers;
    expect(container?.args).toContain(
      `-concurrency=${String(SEAWEEDFS_BACKUP_CONCURRENCY)}`,
    );
    // Each object being copied buffers up to `uploader_concurrency` parts.
    const bufferedMiB =
      SEAWEEDFS_BACKUP_CONCURRENCY *
      sinkSetting("uploader_concurrency") *
      sinkSetting("uploader_part_size");
    expect(bufferedMiB).toBe(256);
    expect(container?.resources.limits.memory).toBe("2048Mi");
    expect(bufferedMiB * 4).toBeLessThanOrEqual(2048);
  });

  test("filer.backup starts only once the filer answers, from its checkpoint", () => {
    const [container] = DeploymentSpecSchema.parse(
      synthesize().find((resource) => resource.kind === "Deployment")?.spec,
    ).template.spec.containers;
    // The wait runs in the container itself, so an in-place restart waits too.
    expect(container?.command).toEqual([
      "/bin/sh",
      "-c",
      SEAWEEDFS_BACKUP_WAIT_FOR_FILER,
      "filer-backup",
    ]);
    expect(container?.args[0]).toBe("filer.backup");
    expect(SEAWEEDFS_BACKUP_WAIT_FOR_FILER).toContain("http://$filer:8888/");
    expect(SEAWEEDFS_BACKUP_WAIT_FOR_FILER).toContain('"$filer" 18888');
    expect(SEAWEEDFS_BACKUP_WAIT_FOR_FILER).toMatch(
      /\nexec \/usr\/bin\/weed "\$@"$/u,
    );
    // Nothing moves the checkpoint: no start offset, no snapshot.
    expect(container?.args.some((arg) => arg.startsWith("-timeAgo"))).toBe(
      false,
    );
  });

  test("its NetworkPolicy admits nothing and reaches only the filer, volumes, DNS and HTTPS", () => {
    const policy = synthesize().find(
      (resource) => resource.kind === "NetworkPolicy",
    );
    const spec = NetworkPolicySpecSchema.parse(policy?.spec);
    expect(spec.policyTypes).toEqual(["Ingress", "Egress"]);
    expect(spec.ingress).toEqual([]);
    const rules = spec.egress.map((rule) => ({
      to: rule.to.map(
        (peer) =>
          peer.ipBlock?.cidr ??
          peer.podSelector?.matchLabels["app.kubernetes.io/component"] ??
          peer.podSelector?.matchLabels["k8s-app"],
      ),
      ports: rule.ports.map(({ port }) => port),
    }));
    expect(rules).toEqual([
      { to: ["kube-dns"], ports: [53, 53] },
      { to: ["filer"], ports: [8888, 18_888] },
      { to: ["volume"], ports: [8080] },
      { to: ["0.0.0.0/0"], ports: [443] },
    ]);
  });
});
