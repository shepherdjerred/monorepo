import type { Construct } from "constructs";
import {
  Fn,
  TerraformIterator,
  TerraformLocal,
  TerraformOutput,
  Token,
} from "cdktn";
import { ApplicationKey } from "#generated/providers/b2/application-key/index.ts";
import { Bucket } from "#generated/providers/b2/bucket/index.ts";
import { B2Provider } from "#generated/providers/b2/provider/index.ts";
import { Item } from "#generated/providers/onepassword/item/index.ts";
import { OnepasswordProvider } from "#generated/providers/onepassword/provider/index.ts";
import { encryptStateAndPlans } from "#src/encryption.ts";
import { HomelabStack } from "#src/homelab-stack.ts";
import { HOMELAB_VAULT_ID } from "#src/onepassword.ts";

// Account region is chosen when the Backblaze account is created.
// us-west-004 is the region these buckets and the S3 endpoint assume.
const REGION = "us-west-004";
const S3_ENDPOINT = "https://s3.us-west-004.backblazeb2.com";

// Completed objects are not expired. Abandoned large-file parts are canceled
// after 7 days. A hidden version stays for 30 days, so an accidental hide can
// be restored, and is then removed.
const VERSION_LIFECYCLE = {
  fileNamePrefix: "",
  daysFromStartingToCancelingUnfinishedLargeFiles: 7,
  daysFromHidingToDeleting: 30,
};

/** One scoped key per bucket, by the bucket's resource name. */
const KEYS = {
  seaweedfs_backups: {
    title: "backblaze-seaweedfs-backups",
    // Velero alone reads an AWS credentials file (`cloud`); see below.
    aws_credentials_file: false,
    capabilities: [
      "listBuckets",
      "listFiles",
      "readFiles",
      "writeFiles",
      "deleteFiles",
      "readFileRetentions",
      "writeFileRetentions",
    ],
  },
  velero: {
    title: "backblaze-velero",
    aws_credentials_file: true,
    capabilities: [
      "listBuckets",
      "listFiles",
      "readFiles",
      "writeFiles",
      "deleteFiles",
    ],
  },
  postgres_wal: {
    title: "backblaze-postgres-wal",
    aws_credentials_file: false,
    capabilities: [
      "listBuckets",
      "listFiles",
      "readFiles",
      "writeFiles",
      "deleteFiles",
    ],
  },
} as const;

/**
 * Operator-only: the private backup buckets and a key scoped to each, written
 * into 1Password. See `src/tofu/backblaze/README.md`.
 */
export class BackblazeStack extends HomelabStack {
  constructor(scope: Construct) {
    super(scope, "backblaze", {
      requiredVersion: ">= 1.11.0",
      // 0.14.1's published signature returns 504, so the lock stays on 0.14.0.
      providerConstraints: { b2: "0.14.0", onepassword: "~> 3.0" },
    });
    encryptStateAndPlans(this, {
      description: "Passphrase encrypting Backblaze state and plans.",
      errorMessage:
        "The state encryption passphrase must contain at least 16 characters.",
    });

    // Operator-applied. The master key is B2_APPLICATION_KEY_ID and
    // B2_APPLICATION_KEY. Create the Backblaze account in us-west-004 so the
    // S3 endpoint in this stack is the one clients use. CI validates this
    // stack and does not plan or apply it.
    new B2Provider(this, "b2");
    // Writes each scoped key into its own 1Password item. Authenticates
    // through the 1Password desktop app for the account named by OP_ACCOUNT.
    new OnepasswordProvider(this, "onepassword");

    const buckets = this.addBuckets();
    this.addKeys(buckets);

    new TerraformOutput(this, "s3_endpoint", {
      description: "S3-compatible endpoint for the account region.",
      value: S3_ENDPOINT,
    });
    new TerraformOutput(this, "region", {
      description: "Backblaze region these buckets belong to.",
      value: REGION,
    });
    new TerraformOutput(this, "bucket_names", {
      description:
        "Private backup buckets. seaweedfs-backups keeps the name Delivery receipts store.",
      value: Token.asAny(
        Object.fromEntries(
          Object.entries(buckets).map(([key, bucket]) => [
            key,
            bucket.bucketName,
          ]),
        ),
      ),
    });
  }

  private addBuckets(): Record<keyof typeof KEYS, Bucket> {
    const seaweedfsBackups = new Bucket(this, "seaweedfs_backups", {
      bucketName: "seaweedfs-backups",
      bucketType: "allPrivate",
      // File Lock is on so later writes can retain objects/ and snapshots/.
      // There is no default retention: gc/ must stay deletable.
      fileLockConfiguration: [{ isFileLockEnabled: true }],
      lifecycleRules: [VERSION_LIFECYCLE],
      lifecycle: { preventDestroy: true },
    });
    // Object Lock stays off. A default retention period applies to every
    // object, and Velero must delete expired backups and their ZFS streams.
    const velero = new Bucket(this, "velero", {
      bucketName: "sjerred-velero",
      bucketType: "allPrivate",
      lifecycleRules: [VERSION_LIFECYCLE],
      lifecycle: { preventDestroy: true },
    });
    // Object Lock stays off. WAL-G deletes base backups and segments itself.
    const postgresWal = new Bucket(this, "postgres_wal", {
      bucketName: "sjerred-postgres-wal",
      bucketType: "allPrivate",
      lifecycleRules: [VERSION_LIFECYCLE],
      lifecycle: { preventDestroy: true },
    });
    return {
      seaweedfs_backups: seaweedfsBackups,
      velero,
      postgres_wal: postgresWal,
    };
  }

  private addKeys(buckets: Record<keyof typeof KEYS, Bucket>): void {
    const bucketIds = new TerraformLocal(
      this,
      "bucket_ids",
      Token.asAny(
        Object.fromEntries(
          Object.entries(buckets).map(([key, bucket]) => [
            key,
            bucket.bucketId,
          ]),
        ),
      ),
    );
    const keys = TerraformIterator.fromMap(KEYS);
    const key = new ApplicationKey(this, "backup", {
      forEach: keys,
      keyName: keys.getString("title"),
      capabilities: keys.getList("capabilities"),
      bucketIds: [Fn.lookup(bucketIds.asStringMap, keys.key)],
    });
    const instance = `${key.terraformResourceType}.${key.friendlyUniqueId}[each.key]`;
    const keyId = `\${${instance}.application_key_id}`;
    const secret = `\${${instance}.application_key}`;

    // Construct ids are unique per scope even across resource types, so the
    // item is named apart from the key and keeps its HCL address explicitly.
    const item = new Item(this, "backup_item", {
      forEach: keys,
      vault: HOMELAB_VAULT_ID,
      title: keys.getString("title"),
      category: "secure_note",
      section: [{ label: "credentials" }],
    });
    item.overrideLogicalId("backup");
    // The section's fields, in the order the item holds them. In JSON syntax
    // OpenTofu expands `dynamic` blocks where the `dynamic` key sits, and
    // cdktn writes keys sorted, so a `dynamic` block would precede literal
    // `field` blocks and reorder the item. Every field is therefore a
    // `dynamic` block, in one ordered list.
    item.addOverride("section.0.dynamic.field", [
      concealedField("B2_ACCESS_KEY_ID", keyId),
      concealedField("B2_SECRET_ACCESS_KEY", secret),
      // The Velero chart mounts its secret's `cloud` key as the AWS shared
      // credentials file that Velero and the openebs plugin authenticate
      // with.
      concealedField(
        "cloud",
        `[default]\naws_access_key_id=${keyId}\naws_secret_access_key=${secret}\n`,
        "${each.value.aws_credentials_file ? [true] : []}",
      ),
    ]);
  }
}

type DynamicField = {
  for_each: string | readonly boolean[];
  content: { label: string; type: "CONCEALED"; value: string };
};

/**
 * One `dynamic "field"` block holding a concealed field. `forEach` decides
 * whether the field exists; a field every item has iterates once.
 */
function concealedField(
  label: string,
  value: string,
  forEach: string | readonly boolean[] = [true],
): DynamicField {
  return { for_each: forEach, content: { label, type: "CONCEALED", value } };
}
