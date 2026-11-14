import {
  DiscordAccountIdSchema,
  ScoutDesktopScopeSchema,
  type DiscordAccountId,
  type ScoutDesktopScope,
} from "@scout-for-lol/data";
import { z } from "zod";
import { prisma } from "#src/database/index.ts";
import { isScoutClientEnabledFor } from "./policy.ts";
import { secretDigest } from "#src/scout-client/secrets.ts";

export type AuthenticatedScoutClient = {
  readonly deviceId: string;
  readonly ownerId: DiscordAccountId;
  readonly appVersion: string;
};

/** A device together with what its owner approved it to do. */
export type ScopedScoutClient = AuthenticatedScoutClient & {
  readonly scopes: readonly ScoutDesktopScope[];
};

// A stored scope outside the contract is a broken invariant (the column has a
// CHECK constraint), so it fails loudly rather than being dropped.
const StoredScopesSchema = z.array(ScoutDesktopScopeSchema).min(1);

/**
 * Resolve the device a `Bearer sct_…` credential names.
 *
 * Reads only the Authorization header: a cookie never authenticates a device
 * route, so a browser session cannot reach one.
 */
export async function authenticateScoutClient(
  request: Request,
  requireEnabledPolicy = true,
): Promise<ScopedScoutClient | null> {
  const authorization = request.headers.get("Authorization");
  if (authorization?.startsWith("Bearer sct_") !== true) return null;
  const token = authorization.slice("Bearer ".length);
  const device = await prisma.scoutClientDevice.findUnique({
    where: { tokenDigest: secretDigest(token) },
    select: {
      id: true,
      ownerId: true,
      appVersion: true,
      deviceState: true,
      scopes: true,
    },
  });
  if (device?.deviceState !== "ACTIVE") return null;
  const ownerId = DiscordAccountIdSchema.parse(device.ownerId);
  return requireEnabledPolicy &&
    !(await isScoutClientEnabledFor("scout_client_ingestion", ownerId))
    ? null
    : {
        deviceId: device.id,
        ownerId,
        appVersion: device.appVersion,
        scopes: StoredScopesSchema.parse(device.scopes),
      };
}
