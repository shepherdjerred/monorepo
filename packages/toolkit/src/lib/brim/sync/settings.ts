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
    recipient: await config.value("brimSyncRecipient"),
    pullSinceDays: await config.value("brimSyncPullSinceDays"),
  };
}

export const IDENTITY_CREDENTIAL = "BRIM_SYNC_AGE_IDENTITY";

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
