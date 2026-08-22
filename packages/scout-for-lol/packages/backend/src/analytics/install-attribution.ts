/**
 * Marketing → install attribution.
 *
 * A single-use token minted by /api/discord/install rides Discord's OAuth
 * `state` parameter through the bot-install round trip and comes back to
 * /app/installed, which posts it to the installAttribution.complete mutation.
 * Attribution lands on the `GuildInstall` row and emits one
 * `guild_install_attributed` event against the installation identity.
 *
 * The gateway `guildCreate` usually fires before the browser lands back, but
 * either side can win. Both funnel through {@link tryAttributeInstall}, whose
 * null-guarded `attributedAt` claim guarantees at most one stamp and one
 * event per installation; `attribution_timing` records which side ran second
 * and therefore completed the join.
 */

import { z } from "zod";
import type { DiscordAccountId, DiscordGuildId } from "@scout-for-lol/data";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import { getErrorMessage } from "#src/utils/errors.ts";
import {
  getProductAnalytics,
  type AttributionSurface,
  type AttributionTiming,
  type ProductAnalytics,
} from "#src/analytics/product-analytics.ts";

const logger = createLogger("install-attribution");

export const AttributionSurfaceSchema = z.enum([
  "guild_picker",
  "onboarding_wizard",
]);

/** How long the Discord round trip itself may take. */
export const INSTALL_ATTRIBUTION_TOKEN_TTL_MS = 15 * 60 * 1000;
/**
 * How long a consumed token waits for the gateway. Much longer than the TTL:
 * the TTL bounds the browser round trip, this bounds a delayed `guildCreate`
 * (shard reconnect, Discord outage). Attribution lost beyond it is bounded
 * and visible as consumed-but-unreconciled rows.
 */
const RECONCILE_WINDOW_MS = 24 * 60 * 60 * 1000;
/**
 * The install must postdate the token (minus clock slack), so authorizing
 * into a guild that already had Scout — guildCreate case 3, which emits no
 * `guild_installed` — cannot fabricate an attribution.
 */
const INSTALL_FRESHNESS_SLACK_MS = 2 * 60 * 1000;
/** Dead tokens are pruned opportunistically on mint; no cron needed. */
const TOKEN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

type AttributionOptions = {
  db?: ExtendedPrismaClient;
  analytics?: ProductAnalytics;
  now?: Date;
};

function randomToken(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Mint and persist a fresh install-attribution token for the signed-in user,
 * pruning long-dead rows while we are here (best-effort).
 */
export async function mintInstallAttributionToken(
  input: { discordId: DiscordAccountId; surface: AttributionSurface },
  options?: AttributionOptions,
): Promise<string> {
  const db = options?.db ?? prisma;
  const now = options?.now ?? new Date();
  const token = randomToken();
  await db.installAttributionToken.create({
    data: {
      token,
      discordId: input.discordId,
      surface: input.surface,
      createdAt: now,
      expiresAt: new Date(now.getTime() + INSTALL_ATTRIBUTION_TOKEN_TTL_MS),
    },
  });
  try {
    await db.installAttributionToken.deleteMany({
      where: {
        expiresAt: { lt: new Date(now.getTime() - TOKEN_RETENTION_MS) },
      },
    });
  } catch (error) {
    logger.warn(
      "Failed to prune expired install-attribution tokens",
      getErrorMessage(error),
    );
  }
  return token;
}

type AttributeResult = "attributed" | "already_installed" | "missing";

/**
 * Claim attribution onto the guild's current installation, if this token may
 * name it. The `attributedAt: null` guard makes the mutation-vs-gateway race
 * emit at most one event.
 */
async function tryAttributeInstall(params: {
  db: ExtendedPrismaClient;
  analytics: ProductAnalytics;
  serverId: string;
  tokenId: number;
  tokenCreatedAt: Date;
  surface: AttributionSurface;
  timing: AttributionTiming;
  now: Date;
}): Promise<AttributeResult> {
  const install = await params.db.guildInstall.findUnique({
    where: { serverId: params.serverId },
    select: {
      id: true,
      serverId: true,
      analyticsInstallationId: true,
      analyticsLifecycleTracked: true,
      installedAt: true,
      removedAt: true,
    },
  });
  if (install?.removedAt !== null) {
    return "missing";
  }
  if (
    install.installedAt.getTime() <
    params.tokenCreatedAt.getTime() - INSTALL_FRESHNESS_SLACK_MS
  ) {
    return "already_installed";
  }

  const claim = await params.db.guildInstall.updateMany({
    where: {
      id: install.id,
      analyticsInstallationId: install.analyticsInstallationId,
      attributedAt: null,
    },
    data: { attributedAt: params.now, attributionSurface: params.surface },
  });
  if (claim.count !== 1) {
    return "already_installed";
  }

  await params.db.installAttributionToken.updateMany({
    where: { id: params.tokenId, reconciledAt: null },
    data: { reconciledAt: params.now },
  });

  params.analytics.capture(install, {
    event: "guild_install_attributed",
    properties: {
      attribution_surface: params.surface,
      attribution_timing: params.timing,
    },
  });
  return "attributed";
}

export type CompleteInstallAttributionResult =
  | { outcome: "invalid" }
  | { outcome: "cancelled" }
  | {
      outcome: "attributed" | "already_installed" | "pending";
      guildId: DiscordGuildId;
      surface: AttributionSurface;
    };

/**
 * Consume the token the browser brought back from Discord and, when the
 * gateway has already created the `GuildInstall` row, complete the join.
 * Bad tokens return outcomes rather than throwing so the landing page can
 * degrade to neutral copy.
 */
export async function completeInstallAttribution(
  input: {
    state: string;
    guildId: DiscordGuildId | undefined;
    discordId: DiscordAccountId;
  },
  options?: AttributionOptions,
): Promise<CompleteInstallAttributionResult> {
  const db = options?.db ?? prisma;
  const analytics = options?.analytics ?? getProductAnalytics();
  const now = options?.now ?? new Date();

  // Single-use claim: expired, replayed, forged, and wrong-user tokens all
  // fail this WHERE clause and are indistinguishable to the caller.
  const claim = await db.installAttributionToken.updateMany({
    where: {
      token: input.state,
      discordId: input.discordId,
      consumedAt: null,
      expiresAt: { gt: now },
    },
    data: { consumedAt: now, guildId: input.guildId ?? null },
  });
  if (claim.count !== 1) {
    return { outcome: "invalid" };
  }

  const token = await db.installAttributionToken.findUnique({
    where: { token: input.state },
  });
  const surface = AttributionSurfaceSchema.safeParse(token?.surface);
  if (token === null || !surface.success) {
    return { outcome: "invalid" };
  }
  if (input.guildId === undefined) {
    // The user backed out on Discord; the token is burned either way.
    return { outcome: "cancelled" };
  }

  const result = await tryAttributeInstall({
    db,
    analytics,
    serverId: input.guildId,
    tokenId: token.id,
    tokenCreatedAt: token.createdAt,
    surface: surface.data,
    timing: "after_gateway",
    now,
  });
  return {
    outcome: result === "missing" ? "pending" : result,
    guildId: input.guildId,
    surface: surface.data,
  };
}

/**
 * Gateway-side reconciliation, called from `saveGuildInstall` after a real
 * install transition. Completes the newest pending token for this guild, if
 * the browser beat the gateway. Best-effort: attribution must never fail
 * install handling.
 */
export async function reconcilePendingInstallAttribution(
  serverId: DiscordGuildId,
  options?: AttributionOptions,
): Promise<void> {
  try {
    const db = options?.db ?? prisma;
    const analytics = options?.analytics ?? getProductAnalytics();
    const now = options?.now ?? new Date();

    const token = await db.installAttributionToken.findFirst({
      where: {
        guildId: serverId,
        consumedAt: { not: null },
        reconciledAt: null,
        createdAt: { gt: new Date(now.getTime() - RECONCILE_WINDOW_MS) },
      },
      orderBy: { createdAt: "desc" },
    });
    if (token === null) {
      return;
    }
    const surface = AttributionSurfaceSchema.safeParse(token.surface);
    if (!surface.success) {
      return;
    }
    await tryAttributeInstall({
      db,
      analytics,
      serverId,
      tokenId: token.id,
      tokenCreatedAt: token.createdAt,
      surface: surface.data,
      timing: "before_gateway",
      now,
    });
  } catch (error) {
    logger.error(
      "Failed to reconcile pending install attribution",
      getErrorMessage(error),
    );
  }
}
