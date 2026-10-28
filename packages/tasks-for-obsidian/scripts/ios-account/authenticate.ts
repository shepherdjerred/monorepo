import assert from "node:assert/strict";
import { z } from "zod";
import type { Manifest } from "../apple-sync-live/model";
import { runIosAuthOnly } from "./phases/auth-host";
import { runIosConnectOnly } from "./phases/connect-host";
import { hasCheckpointFile, phaseFile } from "./phases/checkpoint";

const locator = z.string().regex(/^[A-Za-z0-9]{20,32}$/u);
export const IOSVaultOptionsSchema = z.strictObject({
  vaultPasswordRef: z
    .string()
    .regex(/^op:\/\/[A-Za-z0-9]{20,32}\/[A-Za-z0-9]{20,32}\/password$/u),
  vaultPasswordBackend: z.literal("service-account").default("service-account"),
  lifecycleRound: z.number().int().min(1).max(3).optional(),
});
export type IOSVaultOptions = z.infer<typeof IOSVaultOptionsSchema>;
export const IOSAccountOptionsSchema = IOSVaultOptionsSchema.extend({
  account: locator,
  vault: locator,
  item: locator,
  credentialBackend: z
    .enum(["keychain", "service-account", "desktop"])
    .default("keychain"),
});
export type IOSAccountOptions = z.infer<typeof IOSAccountOptionsSchema>;

/** Two separately bounded sessions; an existing successful checkpoint never repeats authentication. */
export async function runIosAccountAuthentication(
  manifest: Manifest,
  options: IOSAccountOptions,
) {
  assert.ok(
    manifest.schemaVersion === 3 &&
      manifest.scope === "apple" &&
      manifest.allowedRemoteVaultID !== null,
  );
  const settings = IOSAccountOptionsSchema.parse(options);
  if (
    !(await hasCheckpointFile(
      phaseFile(manifest, "auth-checkpoint", settings.lifecycleRound),
    ))
  )
    await runIosAuthOnly(manifest, settings);
  return runIosConnectOnly(
    manifest,
    IOSVaultOptionsSchema.parse({
      vaultPasswordRef: settings.vaultPasswordRef,
      vaultPasswordBackend: settings.vaultPasswordBackend,
      ...(settings.lifecycleRound === undefined
        ? {}
        : { lifecycleRound: settings.lifecycleRound }),
    }),
  );
}
