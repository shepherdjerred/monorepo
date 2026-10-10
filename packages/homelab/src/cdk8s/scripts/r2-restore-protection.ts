/**
 * OpenEBS 3.6.0 chooses an incremental restore's full base by the snapshot's
 * position in its sorted remote schedule/volume history, modulo the configured
 * group size. Removing even a non-ancestor before that position changes the
 * result. Keep the complete preceding history rather than infer independence
 * from a missing Velero Backup or ZFSBackup CR. This deliberately sacrifices
 * reclamation until the producer supplies independently verifiable chains.
 */
export function restoreProtectedBackupNames(input: {
  objectKeys: readonly string[];
  protectedBackupNames: readonly string[];
  zfsPrefix: string;
}): string[] {
  const families = new Map<string, Set<string>>();
  for (const key of input.objectKeys) {
    if (!key.startsWith(input.zfsPrefix)) {
      throw new Error(`Unexpected object outside ZFS backup prefix: ${key}`);
    }
    const relative = key.slice(input.zfsPrefix.length);
    const slash = relative.indexOf("/");
    const name = relative.slice(0, slash);
    const file = relative.slice(slash + 1).replace(/\.zfsvol$/, "");
    const suffix = `-${name}`;
    if (slash < 1 || !file.endsWith(suffix) || file.length <= suffix.length) {
      throw new Error(
        `Unrecognized OpenEBS backup object: ${key}; refusing cleanup`,
      );
    }
    const family = file.slice(0, -suffix.length);
    const names = families.get(family) ?? new Set<string>();
    names.add(name);
    families.set(family, names);
  }
  const roots = new Set(input.protectedBackupNames);
  const protectedNames = new Set<string>();
  for (const names of families.values()) {
    const retained = [...names].filter((name) => roots.has(name)).toSorted();
    const latest = retained.at(-1);
    if (latest === undefined) continue;
    for (const name of names) {
      if (name <= latest) protectedNames.add(name);
    }
  }
  return [...protectedNames].toSorted();
}
