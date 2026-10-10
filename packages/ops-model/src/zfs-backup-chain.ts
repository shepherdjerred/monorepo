/** DRR_BEGIN is a fixed 312-byte record; GUIDs must never pass through Number. */
export function readZfsStreamHeader(bytes: Uint8Array): {
  toGuid: string;
  fromGuid: string;
} {
  if (bytes.byteLength !== 312)
    throw new Error("Incomplete ZFS DRR_BEGIN record");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = 0x2_f5_ba_cb_acn;
  const littleEndian = view.getBigUint64(8, true) === magic;
  if (!littleEndian && view.getBigUint64(8, false) !== magic) {
    throw new Error("Invalid ZFS stream magic");
  }
  if (view.getUint32(0, littleEndian) !== 0) {
    throw new Error("ZFS stream does not start with DRR_BEGIN");
  }
  const toGuid = view.getBigUint64(40, littleEndian);
  if (toGuid === 0n) throw new Error("ZFS snapshot GUID cannot be zero");
  return {
    toGuid: toGuid.toString(),
    fromGuid: view.getBigUint64(48, littleEndian).toString(),
  };
}

export type ZfsBackupStream = {
  key: string;
  backupName: string;
  volume: string;
  toGuid: string;
  fromGuid: string;
};

/** Protect ancestors even when their Velero metadata and ZFSBackup CR expired. */
export function protectZfsBackupChains(
  streams: readonly ZfsBackupStream[],
  retainedBackupNames: readonly string[],
): { protectedBackupNames: string[]; incompleteRoots: string[] } {
  const byGuid = new Map<string, ZfsBackupStream>();
  for (const stream of streams) {
    const id = `${stream.volume}:${stream.toGuid}`;
    if (byGuid.has(id)) throw new Error(`Ambiguous ZFS stream GUID: ${id}`);
    byGuid.set(id, stream);
  }
  const retained = new Set(retainedBackupNames);
  const protectedNames = new Set(retained);
  const incompleteRoots: string[] = [];
  for (const root of streams.filter((stream) =>
    retained.has(stream.backupName),
  )) {
    let current = root;
    const visited = new Set<string>();
    for (;;) {
      if (visited.has(current.toGuid))
        throw new Error(`Cyclic ZFS chain: ${root.key}`);
      visited.add(current.toGuid);
      protectedNames.add(current.backupName);
      if (current.fromGuid === "0") break;
      const parent = byGuid.get(`${current.volume}:${current.fromGuid}`);
      if (parent === undefined) {
        incompleteRoots.push(root.key);
        break;
      }
      current = parent;
    }
  }
  return {
    protectedBackupNames: [...protectedNames].toSorted(),
    incompleteRoots: incompleteRoots.toSorted(),
  };
}
