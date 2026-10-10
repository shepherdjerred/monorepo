import {
  protectZfsBackupChains,
  readZfsStreamHeader,
  type ZfsBackupStream,
} from "@shepherdjerred/ops-model/zfs-backup-chain.ts";
import { r2Configuration, type R2Object } from "./r2-prefix-inventory.ts";

export async function inspectR2ZfsChains(
  objects: readonly R2Object[],
  retainedBackupNames: readonly string[],
) {
  const client = new Bun.S3Client({ ...r2Configuration(), region: "auto" });
  const streams: ZfsBackupStream[] = [];
  const data = objects.filter(
    (object) =>
      !object.key.endsWith(".zfsvol") && !object.key.endsWith(".chain.json"),
  );
  // Bounded Range reads only; never download multi-GiB archives into memory.
  for (let index = 0; index < data.length; index += 8) {
    streams.push(
      ...(await Promise.all(
        data.slice(index, index + 8).map(async (object) => {
          const volume = /pvc-[0-9a-f-]{36}/.exec(object.key)?.[0];
          const backupName = object.key.split("/backups/")[1]?.split("/")[0];
          if (volume === undefined || backupName === undefined)
            throw new Error(`Unrecognized ZFS stream key: ${object.key}`);
          const bytes = new Uint8Array(
            await client.file(object.key).slice(0, 312).arrayBuffer(),
          );
          return {
            key: object.key,
            volume,
            backupName,
            ...readZfsStreamHeader(bytes),
          };
        }),
      )),
    );
  }
  return protectZfsBackupChains(
    streams,
    retainedBackupNames,
    objects.map((object) => object.key),
  );
}
