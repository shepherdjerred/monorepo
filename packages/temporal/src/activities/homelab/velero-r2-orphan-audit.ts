import { Context } from "@temporalio/activity";
import {
  ListObjectsV2Command,
  S3Client,
  type _Object,
  type ListObjectsV2CommandOutput,
} from "@aws-sdk/client-s3";
import {
  veleroOrphanR2BytesTotal,
  veleroOrphanR2PrefixesTotal,
  veleroR2OrphanAuditDurationSeconds,
  veleroR2OrphanAuditRunsTotal,
} from "#observability/metrics.ts";
import { listLiveVeleroBackups } from "./velero-orphan-audit.ts";

// Detection-only sibling of the local velero-orphan-audit: flags R2 prefixes
// under zfspv-incr/backups/ whose backup name appears in neither the live
// `velero.io/v1/Backup` CR set nor the R2 backup metadata, and whose newest
// object predates the 24h safety fence. The orphan definition intentionally
// mirrors the operator cleanup tool
// (packages/homelab/src/cdk8s/scripts/r2-orphan-cleanup-core.ts) so the gauge
// and a manual `bun run r2:orphans -- inspect` agree. Detection only: deletion
// stays a reviewed manual operation (see runbooks/r2-capacity-remediation.md).

const R2_ZFS_PREFIX = "zfspv-incr/backups/";
// Velero nests its own object-store layout beneath the BackupStorageLocation
// prefix, so a backup's metadata really lives at
// torvalds/backups/backups/<name>/.
const R2_BACKUP_METADATA_BACKUPS_PREFIX = "torvalds/backups/backups/";
const R2_ORPHAN_MINIMUM_AGE_HOURS = 24;

export type R2ObjectSummary = {
  key: string;
  size: number;
  lastModified: number;
};

export type VeleroR2OrphanAuditResult = {
  liveBackupCount: number;
  zfsPrefixCount: number;
  orphanPrefixCount: number;
  orphanBytes: number;
  workflowDurationSeconds: number;
};

export type VeleroR2OrphanAuditActivities =
  typeof veleroR2OrphanAuditActivities;

function requiredEnv(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

function parseListedObjects(
  contents: _Object[] | undefined,
  prefix: string,
): R2ObjectSummary[] {
  return (contents ?? []).map((object) => {
    if (object.Key === undefined) {
      throw new Error(`R2 listing under ${prefix} omitted an object key`);
    }
    if (object.Size === undefined) {
      throw new Error(`R2 object ${object.Key} omitted its size`);
    }
    if (object.LastModified === undefined) {
      throw new Error(`R2 object ${object.Key} omitted LastModified`);
    }
    return {
      key: object.Key,
      size: object.Size,
      lastModified: object.LastModified.getTime(),
    };
  });
}

function advanceListingToken(
  listed: ListObjectsV2CommandOutput,
  prefix: string,
): string | undefined {
  const continuationToken =
    listed.IsTruncated === true ? listed.NextContinuationToken : undefined;
  if (continuationToken === undefined && listed.IsTruncated === true) {
    throw new Error(
      `R2 truncated the ${prefix} listing without a continuation token`,
    );
  }
  return continuationToken;
}

async function listR2Objects(
  client: S3Client,
  bucket: string,
  prefix: string,
): Promise<R2ObjectSummary[]> {
  const objects: R2ObjectSummary[] = [];
  let continuationToken: string | undefined;
  do {
    Context.current().heartbeat({
      phase: `list-r2:${prefix}`,
      listed: objects.length,
    });
    const listed = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ...(continuationToken === undefined
          ? {}
          : { ContinuationToken: continuationToken }),
      }),
    );
    objects.push(...parseListedObjects(listed.Contents, prefix));
    continuationToken = advanceListingToken(listed, prefix);
  } while (continuationToken !== undefined);
  return objects;
}

function backupName(key: string, prefix: string): string | undefined {
  if (!key.startsWith(prefix)) return undefined;
  const name = key.slice(prefix.length).split("/")[0];
  return name === undefined || name === "" ? undefined : name;
}

export function computeR2Orphans(input: {
  observedAt: number;
  zfsObjects: readonly R2ObjectSummary[];
  liveBackupNames: readonly string[];
  metadataObjects: readonly R2ObjectSummary[];
}): {
  zfsPrefixCount: number;
  orphanPrefixCount: number;
  orphanBytes: number;
} {
  const metadataNames = new Set(
    input.metadataObjects.flatMap((object) => {
      const name = backupName(object.key, R2_BACKUP_METADATA_BACKUPS_PREFIX);
      return name === undefined ? [] : [name];
    }),
  );
  // Metadata is the independent oracle protecting backups whose CR is briefly
  // absent. ZFS data alongside an empty oracle means the oracle is
  // unavailable, not that nothing needs protecting — fail loudly rather than
  // report every prefix as orphaned.
  if (input.zfsObjects.length > 0 && metadataNames.size === 0) {
    throw new Error(
      `Refusing to evaluate R2 orphans: ${input.zfsObjects.length.toString()} ZFS backup objects exist but Velero metadata under ${R2_BACKUP_METADATA_BACKUPS_PREFIX} is empty`,
    );
  }
  const groups = new Map<string, { bytes: number; newest: number }>();
  for (const object of input.zfsObjects) {
    const name = backupName(object.key, R2_ZFS_PREFIX);
    if (name === undefined) continue;
    const existing = groups.get(name) ?? { bytes: 0, newest: 0 };
    existing.bytes += object.size;
    if (object.lastModified > existing.newest) {
      existing.newest = object.lastModified;
    }
    groups.set(name, existing);
  }
  const protectedNames = new Set([...input.liveBackupNames, ...metadataNames]);
  const cutoff = input.observedAt - R2_ORPHAN_MINIMUM_AGE_HOURS * 3_600_000;
  let orphanPrefixCount = 0;
  let orphanBytes = 0;
  for (const [name, group] of groups) {
    if (protectedNames.has(name)) continue;
    if (group.newest >= cutoff) continue;
    orphanPrefixCount += 1;
    orphanBytes += group.bytes;
  }
  return {
    zfsPrefixCount: groups.size,
    orphanPrefixCount,
    orphanBytes,
  };
}

export const veleroR2OrphanAuditActivities = {
  async runVeleroR2OrphanAudit(): Promise<VeleroR2OrphanAuditResult> {
    const startedAt = Date.now();
    let outcome: "success" | "failure" = "failure";
    try {
      Context.current().heartbeat({ phase: "read-r2-config" });
      const bucket = requiredEnv("VELERO_R2_S3_BUCKET");
      const client = new S3Client({
        endpoint: requiredEnv("VELERO_R2_S3_ENDPOINT"),
        region: "auto",
        forcePathStyle: true,
        credentials: {
          accessKeyId: requiredEnv("VELERO_R2_S3_ACCESS_KEY_ID"),
          secretAccessKey: requiredEnv("VELERO_R2_S3_SECRET_ACCESS_KEY"),
        },
      });

      Context.current().heartbeat({ phase: "list-velero-backups" });
      const liveBackups = await listLiveVeleroBackups();

      const [zfsObjects, metadataObjects] = await Promise.all([
        listR2Objects(client, bucket, R2_ZFS_PREFIX),
        listR2Objects(client, bucket, R2_BACKUP_METADATA_BACKUPS_PREFIX),
      ]);

      const { zfsPrefixCount, orphanPrefixCount, orphanBytes } =
        computeR2Orphans({
          observedAt: Date.now(),
          zfsObjects,
          liveBackupNames: liveBackups,
          metadataObjects,
        });

      veleroOrphanR2PrefixesTotal.set(orphanPrefixCount);
      veleroOrphanR2BytesTotal.set(orphanBytes);

      outcome = "success";
      return {
        liveBackupCount: liveBackups.length,
        zfsPrefixCount,
        orphanPrefixCount,
        orphanBytes,
        workflowDurationSeconds: (Date.now() - startedAt) / 1000,
      };
    } finally {
      veleroR2OrphanAuditRunsTotal.inc({ outcome });
      veleroR2OrphanAuditDurationSeconds.observe(
        (Date.now() - startedAt) / 1000,
      );
    }
  },
};
