import {
  DiscordAccountIdSchema,
  ScoutDesktopScopeSchema,
  type DiscordAccountId,
  type ScoutDesktopScope,
} from "@scout-for-lol/data";
import type { ScopedScoutClient } from "./access/authentication.ts";
import { z } from "zod";
import { prisma } from "#src/database/index.ts";
import { getAppOrigin } from "#src/trpc/auth-web-helpers.ts";
import { digestMatches, randomSecret, secretDigest } from "./secrets.ts";

const PAIRING_TTL_MS = 10 * 60 * 1000;
const ABANDONED_PAIRING_RETENTION_MS = 24 * 60 * 60 * 1000;
const PairingScopesSchema = z.array(ScoutDesktopScopeSchema).min(1);
/** Capital letters without I and O, then digits without 0 and 1. */
const MATCH_CODE_ALPHABET = [
  ...Array.from({ length: 26 }, (_, index) =>
    String.fromCodePoint(65 + index),
  ).filter((letter) => letter !== "I" && letter !== "O"),
  ...Array.from({ length: 8 }, (_, index) => String(index + 2)),
];
const PairingStateSchema = z.enum([
  "PENDING",
  "APPROVED",
  "EXCHANGED",
  "EXPIRED",
]);

export type PairingInput = {
  readonly deviceName: string;
  readonly platform: "windows" | "macos";
  readonly architecture: "x86_64" | "aarch64";
  readonly appVersion: string;
  readonly protocolVersion: 1;
};

export type PairingExchange =
  | { readonly status: "pending" }
  | { readonly status: "expired" }
  | { readonly status: "consumed" }
  | {
      readonly status: "approved";
      readonly deviceId: string;
      readonly token: string;
    };

/**
 * The short code the desktop and the approval page both show.
 *
 * Derived from the pairing id rather than stored: it is not a secret, only a
 * way for the approver to see that the request on the page is the one their
 * own computer started, so a link someone else sent them is recognisable.
 */
export function pairingMatchCode(pairingId: string): string {
  const digest = new Bun.CryptoHasher("sha256").update(pairingId).digest();
  const characters = [...digest.subarray(0, 6)].map(
    (byte) => MATCH_CODE_ALPHABET[byte % MATCH_CODE_ALPHABET.length] ?? "",
  );
  return `${characters.slice(0, 3).join("")}-${characters.slice(3).join("")}`;
}

export async function createPairing(
  input: PairingInput,
  now = new Date(),
  scopes: readonly ScoutDesktopScope[] = ["ingest"],
) {
  await prisma.scoutClientPairing.deleteMany({
    where: {
      state: { in: ["PENDING", "APPROVED", "EXPIRED"] },
      expiresAt: {
        lt: new Date(now.getTime() - ABANDONED_PAIRING_RETENTION_MS),
      },
    },
  });
  const pairingSecret = randomSecret("scp_");
  const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS);
  const pairing = await prisma.scoutClientPairing.create({
    data: {
      secretDigest: secretDigest(pairingSecret),
      deviceName: input.deviceName,
      platform: input.platform,
      architecture: input.architecture,
      appVersion: input.appVersion,
      protocolVersion: input.protocolVersion,
      scopes: PairingScopesSchema.parse(scopes),
      expiresAt,
    },
    select: { id: true },
  });
  return {
    pairingId: pairing.id,
    pairingSecret,
    approvalUrl: `${getAppOrigin()}/app/scout-client/pair/${pairing.id}`,
    expiresAt: expiresAt.toISOString(),
    scopes: PairingScopesSchema.parse(scopes),
    matchCode: pairingMatchCode(pairing.id),
  };
}

export type ScopeUpgradeCreation =
  | {
      readonly status: "created";
      readonly requestId: string;
      readonly approvalUrl: string;
      readonly expiresAt: string;
      readonly scopes: readonly ScoutDesktopScope[];
      readonly matchCode: string;
    }
  | { readonly status: "already-granted" };

/**
 * Ask the owner to add scopes to a device that is already paired.
 *
 * The device proved itself with its token, but that proves nothing about what
 * its owner wants: this only records a pending request on the existing
 * approval page. Nothing changes on the device until a signed-in owner
 * approves it, so a device can never grant itself a scope. The request carries
 * no pairing secret and is never exchanged: approval edits the device row in
 * place, which is why its id, its token and the uploads queued under them are
 * untouched.
 */
export async function createScopeUpgrade(
  device: ScopedScoutClient,
  requested: readonly ScoutDesktopScope[],
  now = new Date(),
): Promise<ScopeUpgradeCreation> {
  const missing = [...new Set(requested)].filter(
    (scope) => !device.scopes.includes(scope),
  );
  if (missing.length === 0) return { status: "already-granted" };
  const scopes = PairingScopesSchema.parse(missing);
  const row = await prisma.scoutClientDevice.findUniqueOrThrow({
    where: { id: device.deviceId },
    select: {
      deviceName: true,
      platform: true,
      architecture: true,
      appVersion: true,
      protocolVersion: true,
    },
  });
  // One open request per device: asking again replaces the earlier link.
  await prisma.scoutClientPairing.updateMany({
    where: { upgradeDeviceId: device.deviceId, state: "PENDING" },
    data: { state: "EXPIRED" },
  });
  const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS);
  const request = await prisma.scoutClientPairing.create({
    data: {
      // Unique and unguessable, and discarded: nothing can exchange it.
      secretDigest: secretDigest(randomSecret("scp_")),
      ...row,
      scopes,
      upgradeDeviceId: device.deviceId,
      expiresAt,
    },
    select: { id: true },
  });
  return {
    status: "created",
    requestId: request.id,
    approvalUrl: `${getAppOrigin()}/app/scout-client/pair/${request.id}`,
    expiresAt: expiresAt.toISOString(),
    scopes,
    matchCode: pairingMatchCode(request.id),
  };
}

export async function pairingForApproval(pairingId: string, now = new Date()) {
  const pairing = await prisma.scoutClientPairing.findUnique({
    where: { id: pairingId },
    select: {
      id: true,
      deviceName: true,
      platform: true,
      architecture: true,
      appVersion: true,
      scopes: true,
      state: true,
      expiresAt: true,
      approvedById: true,
      upgradeDeviceId: true,
      upgradeFor: { select: { ownerId: true, deviceState: true } },
    },
  });
  if (pairing === null) return null;
  const state = PairingStateSchema.parse(pairing.state);
  const scopes = PairingScopesSchema.parse(pairing.scopes);
  if (state === "PENDING" && pairing.expiresAt <= now) {
    await prisma.scoutClientPairing.updateMany({
      where: { id: pairing.id, state: "PENDING" },
      data: { state: "EXPIRED" },
    });
    const expiredState = PairingStateSchema.parse("EXPIRED");
    return { ...pairing, scopes, state: expiredState };
  }
  return { ...pairing, scopes, state };
}

export type PairingApproval =
  "approved" | "expired" | "already-approved" | "not-found" | "not-owner";

/**
 * Approve a pairing as a signed-in web user.
 *
 * A scope upgrade is applied here, in one transaction with the approval: the
 * device row gains the scopes, keeping its id and token. Only the device's
 * own owner can approve it; anyone else is told it is not theirs.
 */
export async function approvePairing(
  pairingId: string,
  approverId: DiscordAccountId,
  now = new Date(),
): Promise<PairingApproval> {
  const pairing = await pairingForApproval(pairingId, now);
  if (pairing === null) return "not-found";
  if (
    pairing.upgradeDeviceId !== null &&
    pairing.upgradeFor?.ownerId !== approverId
  ) {
    return "not-owner";
  }
  if (pairing.state === "EXPIRED" || pairing.expiresAt <= now) return "expired";
  if (pairing.state !== "PENDING") {
    return pairing.approvedById === approverId ? "already-approved" : "expired";
  }
  if (pairing.upgradeDeviceId !== null) {
    return await approveScopeUpgrade(
      {
        pairingId: pairing.id,
        deviceId: pairing.upgradeDeviceId,
        scopes: pairing.scopes,
      },
      approverId,
      now,
    );
  }
  const claimed = await prisma.scoutClientPairing.updateMany({
    where: { id: pairingId, state: "PENDING", expiresAt: { gt: now } },
    data: { state: "APPROVED", approvedById: approverId, approvedAt: now },
  });
  return claimed.count === 1 ? "approved" : "expired";
}

async function approveScopeUpgrade(
  upgrade: {
    readonly pairingId: string;
    readonly deviceId: string;
    readonly scopes: readonly ScoutDesktopScope[];
  },
  approverId: DiscordAccountId,
  now: Date,
): Promise<PairingApproval> {
  const { pairingId, deviceId, scopes } = upgrade;
  return await prisma.$transaction(async (transaction) => {
    const device = await transaction.scoutClientDevice.findFirst({
      where: { id: deviceId, ownerId: approverId, deviceState: "ACTIVE" },
      select: { scopes: true },
    });
    if (device === null) return "not-owner";
    const claimed = await transaction.scoutClientPairing.updateMany({
      where: { id: pairingId, state: "PENDING", expiresAt: { gt: now } },
      data: {
        state: "EXCHANGED",
        approvedById: approverId,
        approvedAt: now,
        exchangedAt: now,
      },
    });
    if (claimed.count !== 1) return "expired";
    const granted = PairingScopesSchema.parse([
      ...new Set([...device.scopes, ...scopes]),
    ]);
    await transaction.scoutClientDevice.update({
      where: { id: deviceId },
      data: { scopes: { set: granted } },
    });
    return "approved";
  });
}

export async function exchangePairing(
  pairingId: string,
  pairingSecret: string,
  now = new Date(),
): Promise<PairingExchange | null> {
  const pairing = await prisma.scoutClientPairing.findUnique({
    where: { id: pairingId },
  });
  // A scope upgrade has no secret anyone holds; it is never exchanged.
  if (
    pairing?.upgradeDeviceId !== null ||
    !digestMatches(pairingSecret, pairing.secretDigest)
  ) {
    return null;
  }
  const state = PairingStateSchema.parse(pairing.state);
  if (pairing.expiresAt <= now) {
    await prisma.scoutClientPairing.updateMany({
      where: { id: pairing.id, state: { in: ["PENDING", "APPROVED"] } },
      data: { state: "EXPIRED" },
    });
    return { status: "expired" };
  }
  if (state === "PENDING") return { status: "pending" };
  if (state !== "APPROVED" || pairing.approvedById === null) {
    return { status: "consumed" };
  }
  const approvedById = DiscordAccountIdSchema.parse(pairing.approvedById);

  const token = randomSecret("sct_");
  const result = await prisma.$transaction(async (transaction) => {
    const claimed = await transaction.scoutClientPairing.updateMany({
      where: { id: pairing.id, state: "APPROVED", expiresAt: { gt: now } },
      data: { state: "EXCHANGED", exchangedAt: now },
    });
    if (claimed.count !== 1) return null;
    return await transaction.scoutClientDevice.create({
      data: {
        ownerId: approvedById,
        pairingId: pairing.id,
        tokenDigest: secretDigest(token),
        deviceName: pairing.deviceName,
        platform: pairing.platform,
        architecture: pairing.architecture,
        appVersion: pairing.appVersion,
        protocolVersion: pairing.protocolVersion,
        // Exactly what the owner saw and approved on the pairing page.
        scopes: PairingScopesSchema.parse(pairing.scopes),
        lastSeenAt: now,
        versions: { create: { appVersion: pairing.appVersion } },
      },
      select: { id: true },
    });
  });
  return result === null
    ? { status: "consumed" }
    : { status: "approved", deviceId: result.id, token };
}

export async function revokeDevice(
  deviceId: string,
  ownerId: DiscordAccountId,
  now = new Date(),
): Promise<boolean> {
  const result = await prisma.scoutClientDevice.updateMany({
    where: { id: deviceId, ownerId, deviceState: "ACTIVE" },
    data: { deviceState: "REVOKED", revokedAt: now },
  });
  return result.count === 1;
}
