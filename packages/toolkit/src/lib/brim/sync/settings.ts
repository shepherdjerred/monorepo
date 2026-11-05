import os from "node:os";
import { resolveCredentials } from "#lib/credentials.ts";
import {
  loadToolkitConfig,
  type ToolkitConfigOptions,
} from "#lib/toolkit-config.ts";
import { createOpener, type Opener } from "./crypto.ts";
import { normalizeMachineId } from "./manifest.ts";

export type BrimSyncSettings = {
  readonly machineId: string;
  readonly displayName: string;
  readonly platform: string;
  readonly bucket: string;
  readonly profile: string;
  readonly s3Credentials: "profile" | "broker";
  readonly recipient: string;
  readonly pullSinceDays: number;
};

export async function loadBrimSyncSettings(
  options: ToolkitConfigOptions & { hostname?: string } = {},
): Promise<BrimSyncSettings> {
  const config = await loadToolkitConfig(options);
  const hostname = options.hostname ?? os.hostname();
  const configuredId = await config.value("brimSyncMachineId");
  return {
    machineId: configuredId ?? normalizeMachineId(hostname),
    displayName: hostname,
    platform: process.platform,
    bucket: await config.value("brimSyncBucket"),
    profile: await config.value("brimSyncProfile"),
    s3Credentials: await config.value("brimSyncS3Credentials"),
    recipient: await config.value("brimSyncRecipient"),
    pullSinceDays: await config.value("brimSyncPullSinceDays"),
  };
}

export const IDENTITY_CREDENTIAL = "BRIM_SYNC_AGE_IDENTITY";
const ACCESS_KEY_CREDENTIAL = "BRIM_SYNC_S3_ACCESS_KEY_ID";
const SECRET_KEY_CREDENTIAL = "BRIM_SYNC_S3_SECRET_ACCESS_KEY";

/**
 * The S3 keys for `broker` mode, resolved through the credential broker so
 * nothing is read from or written to a key file. `profile` mode returns
 * `undefined` and leaves the keys to the AWS profile.
 */
export async function brokeredS3Credentials(
  settings: BrimSyncSettings,
): Promise<{ accessKeyId: string; secretAccessKey: string } | undefined> {
  if (settings.s3Credentials === "profile") return undefined;
  await resolveCredentials([ACCESS_KEY_CREDENTIAL, SECRET_KEY_CREDENTIAL]);
  const accessKeyId = Bun.env[ACCESS_KEY_CREDENTIAL];
  const secretAccessKey = Bun.env[SECRET_KEY_CREDENTIAL];
  if (
    accessKeyId === undefined ||
    secretAccessKey === undefined ||
    accessKeyId.length === 0 ||
    secretAccessKey.length === 0
  ) {
    throw new Error("brim sync S3 credentials resolved to an empty value.");
  }
  return { accessKeyId, secretAccessKey };
}

/**
 * An opener that resolves the age identity on first use, so a push that never
 * needs to decrypt (the normal case) never touches the secret.
 */
export function lazyOpener(): Opener {
  let opener: Opener | null = null;
  return async (sealed) => {
    if (opener === null) {
      await resolveCredentials([IDENTITY_CREDENTIAL]);
      const identity = Bun.env[IDENTITY_CREDENTIAL];
      if (identity === undefined || identity.length === 0) {
        throw new Error(`${IDENTITY_CREDENTIAL} resolved to an empty value.`);
      }
      opener = createOpener(identity);
    }
    return opener(sealed);
  };
}
