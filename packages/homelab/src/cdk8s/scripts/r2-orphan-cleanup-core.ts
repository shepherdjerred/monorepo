import { z } from "zod";
import type { R2Object } from "./r2-prefix-inventory.ts";

export const R2_ORPHAN_MINIMUM_AGE_HOURS = 24;
export const R2_ZFS_PREFIX = "zfspv-incr/backups/";
export const R2_BACKUP_METADATA_PREFIX = "torvalds/backups/";
// Velero nests its own object-store layout (backups/, restores/, metadata/, …)
// beneath the BackupStorageLocation prefix, so a backup's metadata really lives
// at torvalds/backups/backups/<name>/. Slicing only the BSL prefix yields the
// literal "backups" for every key and silently empties the protection set.
export const R2_BACKUP_METADATA_BACKUPS_PREFIX = `${R2_BACKUP_METADATA_PREFIX}backups/`;

const CandidateSchema = z.object({
  prefix: z.string().startsWith(R2_ZFS_PREFIX),
  backupName: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  objects: z.number().int().positive(),
  newest: z.iso.datetime(),
});

export const R2OrphanManifestSchema = z.object({
  contractVersion: z.literal(2),
  observedAt: z.iso.datetime(),
  minimumAgeHours: z.literal(R2_ORPHAN_MINIMUM_AGE_HOURS),
  storage: z.object({
    bucket: z.string().min(1),
    endpointHost: z.string().min(1),
  }),
  heldBackupNames: z.array(z.string().min(1)),
  onlyBackupName: z.string().min(1).nullable(),
  protectedBackupNames: z.array(z.string().min(1)),
  candidates: z.array(CandidateSchema),
});

export type R2OrphanManifest = z.infer<typeof R2OrphanManifestSchema>;

function backupName(key: string, prefix: string): string | undefined {
  if (!key.startsWith(prefix)) return undefined;
  const name = key.slice(prefix.length).split("/")[0];
  return name === undefined || name === "" ? undefined : name;
}

export function metadataBackupNames(objects: readonly R2Object[]): string[] {
  const names = [
    ...new Set(
      objects.flatMap((object) => {
        const name = backupName(object.key, R2_BACKUP_METADATA_BACKUPS_PREFIX);
        return name === undefined ? [] : [name];
      }),
    ),
  ].toSorted();
  // Metadata is the independent oracle protecting backups whose CR is briefly
  // absent before BackupSyncController restores it. If the layout ever drifts
  // again, fail loudly rather than hand back an empty, permissive protection set.
  if (objects.length > 0 && names.length === 0) {
    throw new Error(
      `Velero metadata listing returned ${objects.length.toString()} objects, none under ${R2_BACKUP_METADATA_BACKUPS_PREFIX}; refusing to treat an empty protection set as authoritative`,
    );
  }
  return names;
}

export function buildR2OrphanManifest(input: {
  observedAt: string;
  storage: { bucket: string; endpointHost: string };
  zfsObjects: readonly R2Object[];
  liveBackupNames: readonly string[];
  metadataBackupNames: readonly string[];
  heldBackupNames?: readonly string[];
  onlyBackupName?: string;
}): R2OrphanManifest {
  const observedAt = Date.parse(input.observedAt);
  if (!Number.isFinite(observedAt)) {
    throw new TypeError(`Invalid observation timestamp: ${input.observedAt}`);
  }
  // The listing is scoped to the Velero backups directory, so a moved or
  // mistyped prefix yields zero objects and `metadataBackupNames` has nothing
  // to reject — the drift guard never runs. Zero metadata alongside real ZFS
  // data means the oracle is unavailable, not that nothing needs protecting,
  // and deleting against an unavailable oracle is what destroys a recoverable
  // backup whose CR has not yet been restored by BackupSyncController.
  if (input.zfsObjects.length > 0 && input.metadataBackupNames.length === 0) {
    throw new Error(
      `Refusing to propose R2 orphan deletions: ${input.zfsObjects.length.toString()} ZFS backup objects exist but Velero metadata under ${R2_BACKUP_METADATA_BACKUPS_PREFIX} is empty. Confirm the BackupStorageLocation prefix and metadata layout before cleaning up.`,
    );
  }
  const heldBackupNames = [...new Set(input.heldBackupNames)].toSorted();
  const groups = new Map<
    string,
    { backupName: string; bytes: number; objects: number; newest: string }
  >();
  for (const object of input.zfsObjects) {
    const name = backupName(object.key, R2_ZFS_PREFIX);
    if (name === undefined) continue;
    const existing = groups.get(name) ?? {
      backupName: name,
      bytes: 0,
      objects: 0,
      newest: "",
    };
    existing.bytes += object.size;
    existing.objects += 1;
    if (object.lastModified > existing.newest) {
      existing.newest = object.lastModified;
    }
    groups.set(name, existing);
  }
  const missingHeldNames = heldBackupNames.filter((name) => !groups.has(name));
  if (missingHeldNames.length > 0) {
    throw new Error(
      `Held R2 backup prefix is missing: ${missingHeldNames.join(", ")}; refusing to continue`,
    );
  }
  if (
    input.onlyBackupName !== undefined &&
    heldBackupNames.includes(input.onlyBackupName)
  ) {
    throw new Error(
      `Backup ${input.onlyBackupName} cannot be both held and selected for deletion`,
    );
  }
  if (input.onlyBackupName !== undefined && !groups.has(input.onlyBackupName)) {
    throw new Error(
      `Selected R2 backup prefix is missing: ${input.onlyBackupName}; refusing to continue`,
    );
  }
  const protectedBackupNames = [
    ...new Set([
      ...input.liveBackupNames,
      ...input.metadataBackupNames,
      ...heldBackupNames,
    ]),
  ].toSorted();
  const protectedSet = new Set(protectedBackupNames);
  const cutoff = observedAt - R2_ORPHAN_MINIMUM_AGE_HOURS * 3_600_000;
  const candidates = [...groups.values()]
    .filter(
      (group) =>
        !protectedSet.has(group.backupName) &&
        Date.parse(group.newest) < cutoff &&
        (input.onlyBackupName === undefined ||
          group.backupName === input.onlyBackupName),
    )
    .map((group) => ({
      prefix: `${R2_ZFS_PREFIX}${group.backupName}/`,
      ...group,
    }))
    .toSorted((left, right) => left.prefix.localeCompare(right.prefix));
  if (
    input.onlyBackupName !== undefined &&
    !candidates.some(
      (candidate) => candidate.backupName === input.onlyBackupName,
    )
  ) {
    throw new Error(
      `Selected R2 backup prefix is protected or younger than the 24 hour safety fence: ${input.onlyBackupName}`,
    );
  }

  return R2OrphanManifestSchema.parse({
    contractVersion: 2,
    observedAt: new Date(observedAt).toISOString(),
    minimumAgeHours: R2_ORPHAN_MINIMUM_AGE_HOURS,
    storage: input.storage,
    heldBackupNames,
    onlyBackupName: input.onlyBackupName ?? null,
    protectedBackupNames,
    candidates,
  });
}

export function assertManifestRevalidated(
  approved: R2OrphanManifest,
  current: R2OrphanManifest,
): void {
  if (JSON.stringify(approved) !== JSON.stringify(current)) {
    throw new Error(
      "R2 cleanup manifest no longer matches current Velero and object state; run inspect again",
    );
  }
}
