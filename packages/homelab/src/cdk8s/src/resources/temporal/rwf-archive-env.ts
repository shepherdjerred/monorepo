import { EnvValue, type ISecret } from "cdk8s-plus-31";

/** The SeaweedFS bucket holding archived Red Warfare match recordings. */
export const RWF_ARCHIVE_BUCKET = "the-storm-rwf-recordings";

/**
 * Object storage for the Red Warfare recording archive. The infra worker
 * serves the mining-reset queue that runs the archive Activity: it already
 * holds the narrow exec grant on the Minecraft pod and writes through the
 * Temporal worker's SeaweedFS identity, like the Glitter corpus.
 */
export function rwfArchiveEnv(workerSecret: ISecret): Record<string, EnvValue> {
  return {
    RWF_ARCHIVE_S3_ENDPOINT: EnvValue.fromValue(
      "http://seaweedfs-s3.seaweedfs.svc.cluster.local:8333",
    ),
    RWF_ARCHIVE_S3_BUCKET: EnvValue.fromValue(RWF_ARCHIVE_BUCKET),
    RWF_ARCHIVE_S3_REGION: EnvValue.fromValue("us-east-1"),
    RWF_ARCHIVE_S3_ACCESS_KEY_ID: EnvValue.fromSecretValue({
      secret: workerSecret,
      key: "AWS_ACCESS_KEY_ID",
    }),
    RWF_ARCHIVE_S3_SECRET_ACCESS_KEY: EnvValue.fromSecretValue({
      secret: workerSecret,
      key: "AWS_SECRET_ACCESS_KEY",
    }),
  };
}
