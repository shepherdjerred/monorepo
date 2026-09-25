import {
  DiscordAccountIdSchema,
  type DiscordAccountId,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { secretDigest } from "./secrets.ts";

export type AuthenticatedScoutClient = {
  readonly deviceId: string;
  readonly ownerId: DiscordAccountId;
  readonly appVersion: string;
};

export async function authenticateScoutClient(
  request: Request,
  requireEnabledPolicy = true,
): Promise<AuthenticatedScoutClient | null> {
  const authorization = request.headers.get("Authorization");
  if (authorization?.startsWith("Bearer sct_") !== true) return null;
  const token = authorization.slice("Bearer ".length);
  const device = await prisma.scoutClientDevice.findUnique({
    where: { tokenDigest: secretDigest(token) },
    select: { id: true, ownerId: true, appVersion: true, deviceState: true },
  });
  if (device?.deviceState !== "ACTIVE") return null;
  const ownerId = DiscordAccountIdSchema.parse(device.ownerId);
  return requireEnabledPolicy &&
    !(await isPolicyEnabled("scout_client_ingestion", { user: ownerId }))
    ? null
    : { deviceId: device.id, ownerId, appVersion: device.appVersion };
}
