import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { DiscordAccountIdSchema } from "@scout-for-lol/data";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { prisma } from "#src/database/index.ts";
import {
  protectedProcedure,
  router,
  webMutationProcedure,
} from "#src/trpc/trpc.ts";
import {
  approvePairing,
  pairingForApproval,
  revokeDevice,
} from "#src/scout-client/pairing.ts";

async function requireClientFeature(discordId: string) {
  const user = DiscordAccountIdSchema.parse(discordId);
  if (!(await isPolicyEnabled("scout_client_ingestion", { user }))) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Scout Client pairing is not enabled for this account",
    });
  }
  return user;
}

export const scoutClientRouter = router({
  pairing: protectedProcedure
    .input(z.strictObject({ pairingId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      await requireClientFeature(ctx.user.discordId);
      const pairing = await pairingForApproval(input.pairingId);
      if (pairing === null) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pairing not found",
        });
      }
      return {
        id: pairing.id,
        deviceName: pairing.deviceName,
        platform: pairing.platform,
        architecture: pairing.architecture,
        appVersion: pairing.appVersion,
        state: pairing.state,
        expiresAt: pairing.expiresAt.toISOString(),
      };
    }),

  approve: webMutationProcedure
    .input(z.strictObject({ pairingId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const user = await requireClientFeature(ctx.user.discordId);
      const outcome = await approvePairing(input.pairingId, user);
      if (outcome === "not-found") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pairing not found",
        });
      }
      if (outcome === "expired") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Pairing has expired or was already consumed",
        });
      }
      return { approved: true };
    }),

  devices: protectedProcedure.query(async ({ ctx }) => {
    await requireClientFeature(ctx.user.discordId);
    return await prisma.scoutClientDevice.findMany({
      where: { ownerId: ctx.user.discordId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        deviceName: true,
        platform: true,
        architecture: true,
        appVersion: true,
        deviceState: true,
        lastSeenAt: true,
        createdAt: true,
      },
    });
  }),

  revoke: webMutationProcedure
    .input(z.strictObject({ deviceId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const user = await requireClientFeature(ctx.user.discordId);
      const revoked = await revokeDevice(input.deviceId, user);
      if (!revoked) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Active Scout Client device not found",
        });
      }
      return { revoked: true };
    }),
});
