import { storesFromEnvironment } from "@shepherdjerred/seaweedfs-backup/store";
import {
  coldStartKey,
  type ColdStartWrite,
} from "#lib/delivery/model/oracle-inputs.ts";

export type DeliveryColdStartActivities = typeof deliveryColdStartActivities;

/**
 * Runs on the backup worker, which holds the off-cluster R2 credentials:
 * the snapshot lands content-addressed and as `latest.json`, the object the
 * bootstrap tool reads first (section 6, X7).
 */
export const deliveryColdStartActivities = {
  async writeDeliveryColdStart(input: ColdStartWrite) {
    const { destination, backupBucket } = storesFromEnvironment(Bun.env);
    const bytes = new TextEncoder().encode(JSON.stringify(input.snapshot));
    const key = coldStartKey(input.fingerprint);
    for (const target of [key, "delivery/cold-start/latest.json"])
      await destination.putObject({
        bucket: backupBucket,
        key: target,
        body: bytes,
        contentLength: bytes.byteLength,
        headers: {
          contentType: "application/json",
          metadata: { fingerprint: input.fingerprint },
        },
      });
    return {
      fingerprint: input.fingerprint,
      uri: `s3://${backupBucket}/${key}`,
      writtenAt: new Date().toISOString(),
    };
  },
};
