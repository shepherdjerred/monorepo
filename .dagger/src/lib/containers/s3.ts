import {
  dag,
  type Container,
  type Directory,
  type Secret,
} from "@dagger.io/dagger";
import versions from "../versions.ts";

export type S3SyncOptions = {
  /** The directory to sync to S3 */
  sourceDir: Directory;
  /** S3 bucket name */
  bucketName: string;
  /** Optional prefix/path within bucket (default: root) */
  prefix?: string;
  /** S3 endpoint URL (for S3-compatible services like SeaweedFS) */
  endpointUrl: string;
  /** AWS Access Key ID as a secret */
  accessKeyId: Secret;
  /** AWS Secret Access Key as a secret */
  secretAccessKey: Secret;
  /** Optional AWS region (default: us-east-1) */
  region?: string;
  /** Optional: delete files in S3 that don't exist in source (default: true) */
  deleteRemoved?: boolean;
};

/**
 * Returns a container configured for AWS S3 operations.
 * Uses Alpine Linux with AWS CLI pre-installed for minimal image size.
 *
 * @param customVersion - Optional custom Alpine version to override default
 * @returns A configured container with AWS CLI ready
 */
export function getS3Container(customVersion?: string): Container {
  const version = customVersion ?? versions.alpine;
  return dag
    .container()
    .from(`alpine:${version}`)
    .withExec(["apk", "add", "--no-cache", "aws-cli", "mailcap"])
    .withWorkdir("/workspace");
}

/**
 * Syncs a directory to S3 using aws s3 sync.
 * Compatible with S3-compatible endpoints like SeaweedFS.
 *
 * @param options - S3 sync configuration options
 * @returns The sync output string
 *
 * @example
 * ```ts
 * const output = await syncToS3({
 *   sourceDir: builtSite,
 *   bucketName: "clauderon",
 *   endpointUrl: "http://seaweedfs-s3.seaweedfs.svc.cluster.local:8333",
 *   accessKeyId: dag.setSecret("s3-key", process.env.S3_ACCESS_KEY_ID),
 *   secretAccessKey: dag.setSecret("s3-secret", process.env.S3_SECRET_ACCESS_KEY),
 * });
 * ```
 */
export async function syncToS3(options: S3SyncOptions): Promise<string> {
  const container = getS3SyncContainer(options);
  return await container.stdout();
}

/**
 * Creates an S3 sync container without executing it.
 * Useful when you want to compose the sync with other operations.
 *
 * @param options - S3 sync configuration options
 * @returns A configured container ready for S3 sync
 */
export function getS3SyncContainer(options: S3SyncOptions): Container {
  const region = options.region ?? "us-east-1";
  const deleteFlag = options.deleteRemoved ?? true;
  const prefix = options.prefix ?? "";
  const s3Path = prefix
    ? `s3://${options.bucketName}/${prefix}`
    : `s3://${options.bucketName}/`;

  const args = [
    "aws",
    "s3",
    "sync",
    "/workspace/source",
    s3Path,
    `--endpoint-url=${options.endpointUrl}`,
  ];

  if (deleteFlag) {
    args.push("--delete");
  }

  return getS3Container()
    .withDirectory("/workspace/source", options.sourceDir)
    .withSecretVariable("AWS_ACCESS_KEY_ID", options.accessKeyId)
    .withSecretVariable("AWS_SECRET_ACCESS_KEY", options.secretAccessKey)
    .withEnvVariable("AWS_DEFAULT_REGION", region)
    .withExec(args);
}
