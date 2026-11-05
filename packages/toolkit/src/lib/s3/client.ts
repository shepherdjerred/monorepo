import os from "node:os";
import path from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/**
 * Thin wrapper over the AWS SDK S3 client for SeaweedFS uploads. Credentials
 * and region are resolved by the standard AWS toolchain — `~/.aws/credentials`
 * / `~/.aws/config` profiles and the `AWS_*` environment variables — exactly
 * as the AWS CLI does. Path-style addressing (`forcePathStyle`) is mandatory
 * for SeaweedFS.
 *
 * The SDK applies a profile's `endpoint_url` only when the profile arrives
 * through `AWS_PROFILE`, not through the client's `profile` option, so a named
 * profile would otherwise silently talk to AWS itself. Its endpoint is read
 * here and passed explicitly.
 */

type Environment = Readonly<Record<string, string | undefined>>;

/** `endpoint_url` of `profile` in the AWS config file, if it sets one. */
export async function profileEndpointUrl(
  profile: string,
  environment: Environment = Bun.env,
  home: string = os.homedir(),
): Promise<string | undefined> {
  const file = Bun.file(
    environment["AWS_CONFIG_FILE"] ?? path.join(home, ".aws", "config"),
  );
  if (!(await file.exists())) return undefined;
  const text = await file.text();
  const wanted = profile === "default" ? "default" : `profile ${profile}`;
  let section: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const header = /^\[(.+)\]$/.exec(line);
    if (header !== null) {
      section = header[1]?.trim() ?? null;
      continue;
    }
    if (section !== wanted) continue;
    const entry = /^endpoint_url\s*=\s*(\S+)\s*$/.exec(line);
    if (entry !== null) return entry[1];
  }
  return undefined;
}

/**
 * Construct an S3 client for the given AWS profile. When `profile` is omitted
 * the SDK falls back to its standard resolution (`AWS_PROFILE` or `default`).
 */
export async function createS3Client(profile?: string): Promise<S3Client> {
  if (profile == null || profile.length === 0) {
    return new S3Client({ forcePathStyle: true });
  }
  const endpoint = await profileEndpointUrl(profile);
  return new S3Client({
    forcePathStyle: true, // SeaweedFS requires path-style addressing
    profile,
    ...(endpoint === undefined ? {} : { endpoint }),
  });
}

export type PutObjectParams = {
  bucket: string;
  key: string;
  body: Uint8Array;
  contentType: string;
};

/** Upload a single object. The SDK signs the request via SigV4. */
export async function putObject(
  client: S3Client,
  params: PutObjectParams,
): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: params.bucket,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
    }),
  );
}
