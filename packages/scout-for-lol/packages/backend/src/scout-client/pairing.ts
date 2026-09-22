import {
  DiscordAccountIdSchema,
  type DiscordAccountId,
} from "@scout-for-lol/data";
import { z } from "zod";
import { prisma } from "#src/database/index.ts";
import { getAppOrigin } from "#src/trpc/auth-web-helpers.ts";
import { digestMatches, randomSecret, secretDigest } from "./secrets.ts";

const PAIRING_TTL_MS = 10 * 60 * 1000;
const ABANDONED_PAIRING_RETENTION_MS = 24 * 60 * 60 * 1000;
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

export async function createPairing(input: PairingInput, now = new Date()) {
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
      expiresAt,
    },
    select: { id: true },
  });
  return {
    pairingId: pairing.id,
    pairingSecret,
    approvalUrl: `${getAppOrigin()}/app/scout-client/pair/${pairing.id}`,
    expiresAt: expiresAt.toISOString(),
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
      state: true,
      expiresAt: true,
      approvedById: true,
    },
  });
  if (pairing === null) return null;
  const state = PairingStateSchema.parse(pairing.state);
  if (state === "PENDING" && pairing.expiresAt <= now) {
    await prisma.scoutClientPairing.updateMany({
      where: { id: pairing.id, state: "PENDING" },
      data: { state: "EXPIRED" },
    });
    const expiredState = PairingStateSchema.parse("EXPIRED");
    return { ...pairing, state: expiredState };
  }
  return { ...pairing, state };
}

export async function approvePairing(
  pairingId: string,
  approverId: DiscordAccountId,
  now = new Date(),
): Promise<"approved" | "expired" | "already-approved" | "not-found"> {
  const pairing = await pairingForApproval(pairingId, now);
  if (pairing === null) return "not-found";
  if (pairing.state === "EXPIRED" || pairing.expiresAt <= now) return "expired";
  if (pairing.state !== "PENDING") {
    return pairing.approvedById === approverId ? "already-approved" : "expired";
  }
  const claimed = await prisma.scoutClientPairing.updateMany({
    where: { id: pairingId, state: "PENDING", expiresAt: { gt: now } },
    data: { state: "APPROVED", approvedById: approverId, approvedAt: now },
  });
  return claimed.count === 1 ? "approved" : "expired";
}

export async function exchangePairing(
  pairingId: string,
  pairingSecret: string,
  now = new Date(),
): Promise<PairingExchange | null> {
  const pairing = await prisma.scoutClientPairing.findUnique({
    where: { id: pairingId },
  });
  if (pairing === null || !digestMatches(pairingSecret, pairing.secretDigest)) {
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
