import type { DiscordGuildId } from "@scout-for-lol/domain/identity/discord.ts";
import type { DiscordAccountId } from "@scout-for-lol/data";
import { TRPCError } from "@trpc/server";
import {
  isPolicyEnabled,
  type PolicyFlagName,
} from "#src/configuration/flags.ts";
import { prisma } from "#src/database/index.ts";
import { assertExploreAccess } from "#src/explore/access.ts";
import { DiscordUpstreamError } from "#src/lib/discord-rest.ts";
import {
  authenticateScoutClient,
  type ScopedScoutClient,
} from "#src/scout-client/access/authentication.ts";
import { desktopErrorResponse } from "./contract.ts";
import { desktopReadAllowed } from "./rate-limit.ts";

/**
 * Who a desktop Explore request acts as.
 *
 * A device acts as its owning Discord user and nobody else: the bearer
 * credential names the device, the device names its owner, and Explore access
 * is re-checked against that owner's servers on every request — exactly as a
 * web procedure re-checks it — so leaving every Scout server takes the
 * device's access away too.
 *
 * This deliberately does not go through tRPC's `createContext`. A bearer path
 * there would reach every `protectedProcedure`, several of which mutate
 * without a CSRF check because a cookie session is their only credential.
 * Here the only credential is the device token; a cookie is never read.
 */
export type DesktopExploreCaller = {
  readonly device: ScopedScoutClient;
  readonly userId: DiscordAccountId;
  readonly guildIds: DiscordGuildId[];
};

export type DesktopExploreAuthResult =
  | { readonly ok: true; readonly caller: DesktopExploreCaller }
  | { readonly ok: false; readonly response: Response };

function refuse(
  ...args: Parameters<typeof desktopErrorResponse>
): DesktopExploreAuthResult {
  return { ok: false, response: desktopErrorResponse(...args) };
}

/**
 * The refusal an Explore access failure earns on this surface, or null for
 * a failure this boundary does not expect (which then surfaces as a 500).
 *
 * Only a failed Discord token refresh means the owner must sign in again; it
 * is the one `UNAUTHORIZED` `assertExploreAccess` produces. An outage stays
 * `unavailable`, never a denial.
 */
function exploreAccessRefusal(error: unknown): DesktopExploreAuthResult | null {
  if (!(error instanceof TRPCError)) return null;
  if (
    error.code === "UNAUTHORIZED" &&
    error.cause instanceof DiscordUpstreamError &&
    error.cause.reason === "token_refresh_failed"
  ) {
    return refuse(
      "reauthorize_required",
      "Your Discord login expired. Sign in to Scout on the web again.",
    );
  }
  if (error.code === "FORBIDDEN") {
    return refuse("explore_forbidden", error.message);
  }
  return error.code === "SERVICE_UNAVAILABLE"
    ? refuse("unavailable", error.message)
    : null;
}

/**
 * Whether a flag is on for a device owner: a user-targeted answer first, then
 * each server the owner may use Explore in, so a rollout or a disable can
 * target either. Flags alone answers, with no database read; the guilds are
 * the ones Explore access already resolved.
 */
export async function isOwnerFlagEnabled(
  name: PolicyFlagName,
  userId: DiscordAccountId,
  guildIds: readonly DiscordGuildId[],
): Promise<boolean> {
  if (await isPolicyEnabled(name, { user: userId })) return true;
  for (const server of guildIds) {
    if (await isPolicyEnabled(name, { server })) return true;
  }
  return false;
}

export async function authenticateDesktopExplore(
  request: Request,
  now = Date.now(),
): Promise<DesktopExploreAuthResult> {
  // `false`: Explore is not capture, so the ingestion policy does not gate it.
  const device = await authenticateScoutClient(request, false);
  if (device === null) {
    return refuse("unauthorized", "This device is not signed in.");
  }
  if (!desktopReadAllowed(device.deviceId, now)) {
    return refuse(
      "rate_limited",
      "Too many requests from this device. Try again shortly.",
    );
  }
  if (!device.scopes.includes("explore")) {
    return refuse("scope_required", "Pair this device again to use Explore.");
  }
  // The device row cascades from its owner, so a missing user is a broken
  // invariant rather than a refusal.
  const user = await prisma.user.findUniqueOrThrow({
    where: { discordId: device.ownerId },
  });
  try {
    const guildIds = await assertExploreAccess(user);
    if (
      !(await isOwnerFlagEnabled(
        "scout_desktop_explore_enabled",
        device.ownerId,
        guildIds,
      ))
    ) {
      return refuse(
        "feature_disabled",
        "Explore in Scout Desktop is turned off right now.",
      );
    }
    return {
      ok: true,
      caller: { device, userId: device.ownerId, guildIds },
    };
  } catch (error) {
    const refusal = exploreAccessRefusal(error);
    if (refusal === null) throw error;
    return refusal;
  }
}
