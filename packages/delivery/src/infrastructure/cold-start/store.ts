import { DeliveryError } from "#domain/error.ts";
import { COLD_START_SNAPSHOT } from "#shared/model/cold-start-contract.ts";

/**
 * Reads the newest cold-start snapshot from R2 with the homelab bucket's
 * credential (the one Velero and WAL-G use). Credentials are bootstrap
 * input; without them a restore check pauses rather than guessing.
 */
export function createColdStartReader(credentials: {
  accessKeyId: string | undefined;
  secretAccessKey: string | undefined;
}): () => Promise<unknown> {
  return async () => {
    if (
      credentials.accessKeyId === undefined ||
      credentials.secretAccessKey === undefined
    )
      throw new DeliveryError(
        "PAUSED",
        "The cold-start snapshot credential is not configured",
      );
    const client = new Bun.S3Client({
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      endpoint: COLD_START_SNAPSHOT.endpoint,
      bucket: COLD_START_SNAPSHOT.bucket,
      region: "auto",
    });
    const body: unknown = await client.file(COLD_START_SNAPSHOT.key).json();
    return body;
  };
}
