import { createS3ObjectStore } from "@shepherdjerred/seaweedfs-backup/store";
import {
  COLD_START_SNAPSHOT,
  coldStartArchiveKey,
} from "@shepherdjerred/delivery/model-contract";
import { z } from "zod";
import type { ColdStartWrite } from "#lib/delivery/model/oracle-inputs.ts";

export type DeliveryColdStartActivities = typeof deliveryColdStartActivities;

/** The homelab R2 bucket's credential (Velero's and WAL-G's), from the worker's environment. */
const ColdStartCredentialSchema = z.object({
  CLOUDFLARE_R2_ACCESS_KEY_ID: z.string().min(1),
  CLOUDFLARE_R2_SECRET_ACCESS_KEY: z.string().min(1),
});

/**
 * Runs on the backup worker, which holds the off-cluster R2 credential: the
 * snapshot lands immutably under its write time and catalog revision, then
 * as `latest.json`, the object the bootstrap tool and reconcile-after-restore
 * read (section 6, X7). The receipt names the immutable copy.
 */
export const deliveryColdStartActivities = {
  async writeDeliveryColdStart(input: ColdStartWrite) {
    const credential = ColdStartCredentialSchema.parse(Bun.env);
    const store = createS3ObjectStore({
      endpoint: COLD_START_SNAPSHOT.endpoint,
      accessKeyId: credential.CLOUDFLARE_R2_ACCESS_KEY_ID,
      secretAccessKey: credential.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
      region: "auto",
    });
    const bytes = new TextEncoder().encode(JSON.stringify(input.snapshot));
    const archive = coldStartArchiveKey(input.snapshot);
    for (const key of [archive, COLD_START_SNAPSHOT.key])
      await store.putObject({
        bucket: COLD_START_SNAPSHOT.bucket,
        key,
        body: bytes,
        contentLength: bytes.byteLength,
        headers: {
          contentType: "application/json",
          metadata: { fingerprint: input.fingerprint },
        },
      });
    return {
      fingerprint: input.fingerprint,
      uri: `s3://${COLD_START_SNAPSHOT.bucket}/${archive}`,
      writtenAt: input.snapshot.writtenAt,
    };
  },
};
