import type { DiscordAccountId } from "@scout-for-lol/domain/identity/discord.ts";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { DiscordAccountIdSchema } from "@scout-for-lol/data";
import { isScoutClientEnabledFor } from "#src/scout-client/access/policy.ts";
import { prisma } from "#src/database/index.ts";
import { readClientGameResults } from "#src/scout-client/game-results.ts";
import {
  protectedProcedure,
  router,
  webMutationProcedure,
} from "#src/trpc/trpc.ts";
import {
  approvePairing,
  pairingForApproval,
  pairingMatchCode,
  revokeDevice,
} from "#src/scout-client/pairing.ts";

async function requireClientFeature(discordId: DiscordAccountId) {
  const user = DiscordAccountIdSchema.parse(discordId);
  if (!(await isScoutClientEnabledFor("scout_client_ingestion", user))) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Scout Client pairing is not enabled for this account",
    });
  }
  return user;
}

export const scoutClientRouter = router({
  results: protectedProcedure
    .input(
      z.strictObject({ limit: z.number().int().min(1).max(100).default(20) }),
    )
    .query(async ({ ctx, input }) => {
      const owner = await requireClientFeature(ctx.user.discordId);
      return await readClientGameResults(owner, input.limit);
    }),
  pairing: protectedProcedure
    .input(z.strictObject({ pairingId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      await requireClientFeature(ctx.user.discordId);
      const pairing = await pairingForApproval(input.pairingId);
      // An upgrade request names an existing device, so its page belongs to
      // that device's owner alone; anyone else sees nothing.
      if (
        pairing === null ||
        (pairing.upgradeDeviceId !== null &&
          pairing.upgradeFor?.ownerId !== ctx.user.discordId)
      ) {
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
        scopes: pairing.scopes,
        /** True when approving adds the scopes to the device named here. */
        upgrade: pairing.upgradeDeviceId !== null,
        // Only a `pairings/v2` request asks for Explore, and only a client
        // that sends one displays the code, so an older client's request is
        // not shown a code its owner has nothing to compare with.
        matchCode:
          pairing.upgradeDeviceId !== null || pairing.scopes.includes("explore")
            ? pairingMatchCode(pairing.id)
            : null,
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
      if (outcome === "not-owner") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This device belongs to a different Scout account",
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
