import { z } from "zod";
import {
  protectZfsBackupChains,
  readZfsStreamHeader,
  type ZfsBackupStream,
} from "@shepherdjerred/ops-model/zfs-backup-chain.ts";
import { r2Configuration, type R2Object } from "./r2-prefix-inventory.ts";

// R2 throttles bursts of ranged reads with transient 503s ("Reduce your rate
// of simultaneous reads on the same object"). Retry only those provider codes;
// every other error still fails the inspection.
const TRANSIENT_R2_CODES = new Set([
  "ServiceUnavailable",
  "SlowDown",
  "InternalError",
]);
const HEADER_READ_ATTEMPTS = 6;

const TransientR2ErrorSchema = z.object({
  code: z.string().refine((code) => TRANSIENT_R2_CODES.has(code)),
});

function isTransientR2Error(error: unknown): boolean {
  return TransientR2ErrorSchema.safeParse(error).success;
}

async function readHeaderBytes(
  client: Bun.S3Client,
  key: string,
): Promise<Uint8Array> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return new Uint8Array(await client.file(key).slice(0, 312).arrayBuffer());
    } catch (error) {
      if (attempt >= HEADER_READ_ATTEMPTS || !isTransientR2Error(error))
        throw error;
      await Bun.sleep(1000 * 2 ** (attempt - 1));
    }
  }
}

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
          const bytes = await readHeaderBytes(client, object.key);
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
