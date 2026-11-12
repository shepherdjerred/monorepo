import type { TerraformStack, TerraformVariable } from "cdktn";
import { R2BucketLifecycle } from "#generated/providers/cloudflare/r2-bucket-lifecycle/index.ts";
import { R2Bucket } from "#generated/providers/cloudflare/r2-bucket/index.ts";
import { R2CustomDomain } from "#generated/providers/cloudflare/r2-custom-domain/index.ts";
import { R2ManagedDomain } from "#generated/providers/cloudflare/r2-managed-domain/index.ts";
import type { Zones } from "#src/stacks/cloudflare/zones.ts";
import { forget, protect } from "#src/state-migrations.ts";

const ONE_DAY_SECONDS = 86_400;
const SEVEN_DAYS_SECONDS = 604_800;

type Bucket = {
  /**
   * Resource name of the bucket and of everything declared for it. Each
   * resource type has its own namespace in OpenTofu but shares one in the
   * construct tree, so only the bucket takes the name as its construct id and
   * the others override their logical id to it.
   */
  resource: string;
  name: string;
  /** The rule that aborts abandoned multipart uploads; it expires nothing. */
  abortMultipartUploads: { ruleId: string; maxAgeSeconds: number };
  /**
   * The custom domain the bucket is public through, which also owns that DNS
   * record. The provider cannot import a custom domain, so its state entry
   * was adopted from a refresh of the live domain (see
   * `packages/homelab/src/tofu/README.md`). Destroying it takes the public
   * downloads offline.
   */
  publicDomain?: { domain: string; zoneId: string };
  /** Import the bucket that already exists under this name. */
  adopted?: true;
};

/**
 * An R2 bucket that is never destroyed, with its `r2.dev` development URL
 * disabled and a lifecycle that only removes abandoned upload parts.
 */
function bucket(
  stack: TerraformStack,
  accountId: TerraformVariable,
  config: Bucket,
): void {
  const account = accountId.stringValue;
  const r2 = protect(
    new R2Bucket(stack, config.resource, {
      accountId: account,
      name: config.name,
      location: "WNAM",
      storageClass: "Standard",
    }),
  );
  if (config.adopted === true)
    r2.importFrom(
      `\${nonsensitive(var.cloudflare_account_id)}/${config.name}/default`,
    );

  if (config.publicDomain !== undefined) {
    protect(
      new R2CustomDomain(stack, `r2_custom_domain_${config.resource}`, {
        accountId: account,
        bucketName: r2.name,
        domain: config.publicDomain.domain,
        zoneId: config.publicDomain.zoneId,
        enabled: true,
      }),
    ).overrideLogicalId(config.resource);
  }

  new R2ManagedDomain(stack, `r2_managed_domain_${config.resource}`, {
    accountId: account,
    bucketName: r2.name,
    enabled: false,
  }).overrideLogicalId(config.resource);

  new R2BucketLifecycle(stack, `r2_bucket_lifecycle_${config.resource}`, {
    accountId: account,
    bucketName: r2.name,
    rules: [
      {
        id: config.abortMultipartUploads.ruleId,
        enabled: true,
        conditions: { prefix: "" },
        abortMultipartUploadsTransition: {
          condition: {
            type: "Age",
            maxAge: config.abortMultipartUploads.maxAgeSeconds,
          },
        },
      },
    ],
  }).overrideLogicalId(config.resource);
}

export function buckets(
  stack: TerraformStack,
  accountId: TerraformVariable,
  zones: Zones,
): void {
  // Private, off-site storage for personal archives retired from active sync,
  // and its counterpart for Pinterest work archives retired from the vaults.
  for (const [resource, name] of [
    ["jerred_archives", "jerred-archives"],
    ["pinterest_archives", "pinterest-archives"],
  ] as const) {
    bucket(stack, accountId, {
      resource,
      name,
      abortMultipartUploads: {
        ruleId: "abort-incomplete-multipart-uploads-7d",
        maxAgeSeconds: SEVEN_DAYS_SECONDS,
      },
    });
  }

  // Public file downloads served at files.sjer.red. Public reads are
  // intentional. The lifecycle rule keeps the id and age R2 created it with.
  bucket(stack, accountId, {
    resource: "sjerred",
    name: "sjerred",
    adopted: true,
    publicDomain: { domain: "files.sjer.red", zoneId: zones["sjer.red"].id },
    abortMultipartUploads: {
      ruleId: "Default Multipart Abort Rule",
      maxAgeSeconds: ONE_DAY_SECONDS,
    },
  });

  // Public downloads for The Storm, such as legacy world snapshots, served at
  // storage.ts-mc.net. Public reads are intentional.
  bucket(stack, accountId, {
    resource: "ts_mc",
    name: "ts-mc",
    adopted: true,
    publicDomain: {
      domain: "storage.ts-mc.net",
      zoneId: zones["ts-mc.net"].id,
    },
    abortMultipartUploads: {
      ruleId: "Default Multipart Abort Rule",
      maxAgeSeconds: SEVEN_DAYS_SECONDS,
    },
  });

  retiredBuckets(stack);
}

/**
 * Buckets this stack stopped managing without destroying; an operator empties
 * and deletes each out-of-band. A `removed` block is a no-op once the
 * resource has left state.
 */
function retiredBuckets(stack: TerraformStack): void {
  // The Glitter Discord corpus is written to SeaweedFS only; this bucket was
  // an unused leftover.
  forget(stack, "cloudflare_r2_bucket.glitter_discord_corpus");

  // The SeaweedFS object backup to `seaweedfs-backups` is retired: Velero's
  // scheduled backups are the only backup. The bucket is deleted once its
  // 30-day object locks have expired.
  forget(stack, "cloudflare_r2_bucket.seaweedfs_backups");
  forget(stack, "cloudflare_r2_bucket_lock.seaweedfs_backups");
  forget(stack, "cloudflare_r2_bucket_lifecycle.seaweedfs_backups");

  // `postgres-wal` was declared for a WAL-G archive that never used it (WAL-G
  // wrote under the `homelab` bucket), and WAL archiving is retired.
  forget(stack, "cloudflare_r2_bucket.postgres_wal");
  forget(stack, "cloudflare_r2_bucket_lifecycle.postgres_wal");

  // `homelab` held Velero's backups and ZFS streams until Velero moved to the
  // Backblaze `sjerred-velero` bucket (`backblaze` stack).
  forget(stack, "cloudflare_r2_bucket.homelab");
  forget(stack, "cloudflare_r2_bucket_lifecycle.homelab");
}
