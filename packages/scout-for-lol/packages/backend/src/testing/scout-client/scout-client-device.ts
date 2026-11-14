import type { DiscordAccountId, ScoutDesktopScope } from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";

/**
 * A paired Scout Client desktop device owned by `ownerId`, for integration
 * tests that store observations against a real device row.
 *
 * The owner's `User` row is created if the test hasn't already made it. Pass
 * `appVersion` to also record that version as one the device authenticated
 * with, which ingress requires before it accepts the device's observations.
 * Pass `tokenDigest` to authenticate as the device with a known bearer token,
 * and `scopes` to grant more than the default `ingest`.
 */
export async function createTestScoutClientDevice(
  prisma: ExtendedPrismaClient,
  ownerId: DiscordAccountId,
  options: {
    readonly appVersion?: string;
    readonly tokenDigest?: string;
    readonly scopes?: readonly ScoutDesktopScope[];
  } = {},
): Promise<string> {
  const device = await prisma.scoutClientDevice.create({
    data: {
      owner: {
        connectOrCreate: {
          where: { discordId: ownerId },
          create: { discordId: ownerId, discordUsername: "owner" },
        },
      },
      pairing: {
        create: {
          secretDigest: crypto.randomUUID(),
          deviceName: "desktop",
          platform: "windows",
          architecture: "x86_64",
          appVersion: "0.1.0",
          protocolVersion: 1,
          expiresAt: new Date(Date.now() + 60_000),
        },
      },
      tokenDigest: options.tokenDigest ?? crypto.randomUUID(),
      ...(options.scopes === undefined ? {} : { scopes: [...options.scopes] }),
      deviceName: "desktop",
      platform: "windows",
      architecture: "x86_64",
      appVersion: "0.1.0",
      protocolVersion: 1,
      ...(options.appVersion === undefined
        ? {}
        : { versions: { create: { appVersion: options.appVersion } } }),
    },
  });
  return device.id;
}
