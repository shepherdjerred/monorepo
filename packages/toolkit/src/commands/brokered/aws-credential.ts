import { resolveCredentialValues } from "#lib/credentials.ts";
import type { CredentialDeps } from "#lib/credentials.ts";

/**
 * `toolkit aws credential <profile>`: the AWS `credential_process` for the
 * workstation's S3-compatible profiles. The AWS CLI and SDKs call it once per
 * process; the keys never land in `~/.aws/credentials`.
 *
 * It refuses an interactive terminal so the secret is not printed by hand.
 */

export const AWS_CREDENTIAL_PROFILES: ReadonlyMap<
  string,
  { readonly accessKeyId: string; readonly secretAccessKey: string }
> = new Map([
  [
    "seaweedfs",
    {
      accessKeyId: "SEAWEEDFS_S3_ACCESS_KEY_ID",
      secretAccessKey: "SEAWEEDFS_S3_SECRET_ACCESS_KEY",
    },
  ],
  [
    "brim-sync",
    {
      accessKeyId: "BRIM_SYNC_S3_ACCESS_KEY_ID",
      secretAccessKey: "BRIM_SYNC_S3_SECRET_ACCESS_KEY",
    },
  ],
  [
    "b2-velero",
    {
      accessKeyId: "B2_VELERO_ACCESS_KEY_ID",
      secretAccessKey: "B2_VELERO_SECRET_ACCESS_KEY",
    },
  ],
  [
    "b2-postgres-wal",
    {
      accessKeyId: "B2_POSTGRES_WAL_ACCESS_KEY_ID",
      secretAccessKey: "B2_POSTGRES_WAL_SECRET_ACCESS_KEY",
    },
  ],
  [
    "b2-seaweedfs-backups",
    {
      accessKeyId: "B2_SEAWEEDFS_BACKUPS_ACCESS_KEY_ID",
      secretAccessKey: "B2_SEAWEEDFS_BACKUPS_SECRET_ACCESS_KEY",
    },
  ],
]);

/** Matches the Keychain cache TTL so long-lived SDK clients refresh. */
export const AWS_CREDENTIAL_LIFETIME_MS = 60 * 60 * 1000;

export function credentialProcessOutput(
  keys: { readonly accessKeyId: string; readonly secretAccessKey: string },
  now: Date,
): string {
  return JSON.stringify({
    Version: 1,
    AccessKeyId: keys.accessKeyId,
    SecretAccessKey: keys.secretAccessKey,
    Expiration: new Date(
      now.getTime() + AWS_CREDENTIAL_LIFETIME_MS,
    ).toISOString(),
  });
}

export async function runAwsCredential(
  args: readonly string[],
  stdoutIsTerminal: boolean = process.stdout.isTTY,
  deps?: CredentialDeps,
): Promise<number> {
  const profile = args[0];
  const names =
    profile === undefined ? undefined : AWS_CREDENTIAL_PROFILES.get(profile);
  if (names === undefined || args.length !== 1) {
    console.error(
      `Usage: toolkit aws credential <${[...AWS_CREDENTIAL_PROFILES.keys()].join("|")}>`,
    );
    return 2;
  }
  if (stdoutIsTerminal) {
    console.error(
      "toolkit: `aws credential` is an AWS credential_process and prints secret keys; refusing to write them to a terminal. Use `aws --profile` instead.",
    );
    return 2;
  }
  const values = await resolveCredentialValues(
    [names.accessKeyId, names.secretAccessKey],
    deps,
  );
  console.log(
    credentialProcessOutput(
      {
        accessKeyId: values[names.accessKeyId] ?? "",
        secretAccessKey: values[names.secretAccessKey] ?? "",
      },
      new Date(),
    ),
  );
  return 0;
}
